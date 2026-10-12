import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { LeadAssignmentService } from '../src/modules/leads/application/lead-assignment.service';
import { Lead } from '../src/modules/leads/domain/lead.entity';
import { createLead, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

describe('Leads', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app?.close());

  describe('alta', () => {
    it('normaliza el teléfono argentino al formato de WhatsApp y queda a cargo de quien lo carga', async () => {
      const agent = await createUser(app);
      const lead = await createLead(app, agent, { phone: '0341 15 555-1234', email: ' Cliente@Mail.com ' });
      expect(lead.phone).toBe('+5493415551234');
      expect(lead.assignedTo?.id).toBe(agent.id);
      const saved = await http(app).get(`/leads/${lead.id}`).set(agent.auth).expect(200);
      expect(saved.body.email).toBe('cliente@mail.com');
    });

    it('exige teléfono o email', async () => {
      const agent = await createUser(app);
      await http(app).post('/leads').set(agent.auth).send({ fullName: 'Sin datos' }).expect(400);
    });

    it('no permite dos leads con el mismo teléfono aunque esté escrito distinto', async () => {
      const agent = await createUser(app);
      await createLead(app, agent, { phone: '341 555-1234' });
      await http(app).post('/leads').set(agent.auth).send({ fullName: 'Otro', phone: '+54 9 341 555 1234' }).expect(409);
    });

    it('si el asesor elegido está inactivo, no se guarda nada', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const agent = await createUser(app);
      await http(app).patch(`/users/${agent.id}`).set(admin.auth).send({ isActive: false }).expect(200);
      await http(app).post('/leads').set(admin.auth).send({ fullName: 'X', phone: '3415550000', assignedUserId: agent.id }).expect(400);
      const list = await http(app).get('/leads').set(admin.auth).expect(200);
      expect(list.body.total).toBe(0);
    });

    it('al dejar el lead sin teléfono ni email se rechaza el cambio', async () => {
      const agent = await createUser(app);
      const lead = await createLead(app, agent);
      await http(app).patch(`/leads/${lead.id}`).set(agent.auth).send({ phone: null }).expect(400);
    });
  });

  describe('asignación', () => {
    let admin: TestUser;
    let ana: TestUser;
    let beto: TestUser;

    beforeEach(async () => {
      admin = await createUser(app, UserRole.ADMIN);
      ana = await createUser(app, UserRole.AGENT, { fullName: 'Ana' });
      beto = await createUser(app, UserRole.AGENT, { fullName: 'Beto' });
    });

    const assign = (actor: TestUser, leadId: string, userId: string | null) =>
      http(app).patch(`/leads/${leadId}/assign`).set(actor.auth).send({ userId });

    it('un asesor puede tomar un lead sin asignar', async () => {
      const lead = await createLead(app, admin);
      await assign(admin, lead.id, null).expect(200);
      const res = await assign(ana, lead.id, ana.id).expect(200);
      expect(res.body.assignedTo).toEqual({ id: ana.id, fullName: 'Ana' }); // solo id y nombre, nada de email
    });

    it('un asesor puede pasarle su lead a un compañero', async () => {
      const lead = await createLead(app, ana);
      const res = await assign(ana, lead.id, beto.id).expect(200);
      expect(res.body.assignedTo.id).toBe(beto.id);
    });

    it('un asesor NO puede sacarle un lead a un compañero', async () => {
      const lead = await createLead(app, beto);
      await assign(ana, lead.id, ana.id).expect(403);
      await assign(ana, lead.id, null).expect(403);
    });

    it('un admin reasigna cualquier lead, pero no a alguien inactivo', async () => {
      const lead = await createLead(app, ana);
      await assign(admin, lead.id, beto.id).expect(200);
      await http(app).patch(`/users/${ana.id}`).set(admin.auth).send({ isActive: false }).expect(200);
      await assign(admin, lead.id, ana.id).expect(400);
    });

    it('al asignado le llega un aviso; a los demás asesores no', async () => {
      const lead = await createLead(app, admin);
      await assign(admin, lead.id, beto.id).expect(200);

      const forBeto = await http(app).get('/notifications').set(beto.auth).expect(200);
      expect(forBeto.body).toEqual([expect.objectContaining({ type: 'lead_asignado', leadId: lead.id })]);
      const forAna = await http(app).get('/notifications').set(ana.auth).expect(200);
      expect(forAna.body).toEqual([]);
    });

    it('filtra "mis leads" y "sin asignar"', async () => {
      const mine = await createLead(app, ana);
      await createLead(app, beto);
      const free = await createLead(app, admin);
      await assign(admin, free.id, null).expect(200);

      const me = await http(app).get('/leads').query({ assignedTo: 'me' }).set(ana.auth).expect(200);
      expect(me.body.items.map((l: Lead) => l.id)).toEqual([mine.id]);
      const none = await http(app).get('/leads').query({ assignedTo: 'none' }).set(ana.auth).expect(200);
      expect(none.body.items.map((l: Lead) => l.id)).toEqual([free.id]);
    });
  });

  describe('reparto automático (leads de WhatsApp)', () => {
    /** Lead nuevo sin asignar, como lo crea el webhook. */
    async function incomingLead(): Promise<Lead> {
      const repo = app.get(DataSource).getRepository(Lead);
      return repo.save(repo.create({ phone: `+549341${Math.floor(1e6 + Math.random() * 8e6)}`, fullName: 'Desde WhatsApp' }));
    }
    const assigneeOf = async (lead: Lead) =>
      (await app.get(DataSource).getRepository(Lead).findOne({ where: { id: lead.id }, relations: { assignedTo: true } }))?.assignedTo?.id ?? null;
    const autoAssign = (lead: Lead) => app.get(LeadAssignmentService).autoAssign(lead);

    it('va al asesor activo con menos leads abiertos (los cerrados y perdidos no cuentan)', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const ana = await createUser(app);
      const beto = await createUser(app);
      // Ana: 2 abiertos. Beto: 1 abierto + 3 cerrados/perdidos.
      await createLead(app, admin, { assignedUserId: ana.id });
      await createLead(app, admin, { assignedUserId: ana.id });
      await createLead(app, admin, { assignedUserId: beto.id });
      for (const stage of ['cerrado', 'perdido', 'cerrado']) await createLead(app, admin, { assignedUserId: beto.id, stage });

      const lead = await incomingLead();
      await autoAssign(lead);
      expect(await assigneeOf(lead)).toBe(beto.id);

      const forBeto = await http(app).get('/notifications').set(beto.auth).expect(200);
      expect(forBeto.body[0]).toMatchObject({ type: 'lead_asignado', leadId: lead.id });
    });

    it('saltea a los asesores inactivos', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const ana = await createUser(app);
      const beto = await createUser(app);
      await createLead(app, admin, { assignedUserId: ana.id });
      await http(app).patch(`/users/${beto.id}`).set(admin.auth).send({ isActive: false }).expect(200);

      const lead = await incomingLead();
      await autoAssign(lead);
      expect(await assigneeOf(lead)).toBe(ana.id);
    });

    it('si no hay asesores, va a un administrador', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const lead = await incomingLead();
      await autoAssign(lead);
      expect(await assigneeOf(lead)).toBe(admin.id);
    });

    it('con AUTO_ASSIGN_LEADS=false queda sin asignar', async () => {
      await createUser(app);
      process.env.AUTO_ASSIGN_LEADS = 'false';
      try {
        const lead = await incomingLead();
        await autoAssign(lead);
        expect(await assigneeOf(lead)).toBeNull();
      } finally {
        delete process.env.AUTO_ASSIGN_LEADS;
      }
    });
  });

  it('borrar un lead lo saca de todos lados', async () => {
    const agent = await createUser(app);
    const lead = await createLead(app, agent);
    await http(app).delete(`/leads/${lead.id}`).set(agent.auth).expect(204);
    await http(app).get(`/leads/${lead.id}`).set(agent.auth).expect(404);
    await http(app).delete(`/leads/${lead.id}`).set(agent.auth).expect(404);
  });
});
