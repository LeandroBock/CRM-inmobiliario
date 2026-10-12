import { NestExpressApplication } from '@nestjs/platform-express';
import { VisitsService } from '../src/modules/visits/application/visits.service';
import { createLead, createProperty, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Mañana a la hora indicada (hora argentina, UTC-3), en ISO. */
function tomorrowAt(hhmm: string): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  const day = d.toISOString().slice(0, 10);
  return `${day}T${hhmm}:00-03:00`;
}

describe('Visitas', () => {
  let app: NestExpressApplication;
  let agent: TestUser;
  let propertyId: string;
  let leadId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    agent = await createUser(app);
    propertyId = (await createProperty(app, agent)).id;
    leadId = (await createLead(app, agent)).id;
  });
  afterAll(() => app?.close());

  const schedule = (body: Record<string, unknown>) =>
    http(app).post('/visits').set(agent.auth).send({ leadId, propertyId, ...body });

  it('agenda una visita confirmada y el lead pasa a "visita agendada"', async () => {
    const res = await schedule({ startAt: tomorrowAt('17:00') }).expect(201);
    expect(res.body).toMatchObject({ status: 'confirmada', durationMin: 45, source: 'asesor' });
    // Se guarda en UTC: 17:00 en Argentina son las 20:00 UTC
    expect(res.body.startAt).toMatch(/T20:00:00/);

    const lead = await http(app).get(`/leads/${leadId}`).set(agent.auth).expect(200);
    expect(lead.body.stage).toBe('visita_agendada');
  });

  it('no deja superponer dos visitas a la misma propiedad', async () => {
    await schedule({ startAt: tomorrowAt('17:00') }).expect(201); // 17:00 a 17:45
    await schedule({ startAt: tomorrowAt('17:30') }).expect(409); // empieza antes de que termine la otra
    await schedule({ startAt: tomorrowAt('16:30') }).expect(409); // termina 17:15, pisa el comienzo
    await schedule({ startAt: tomorrowAt('16:00'), durationMin: 120 }).expect(409); // la contiene
  });

  it('una visita puede empezar justo cuando termina la anterior', async () => {
    await schedule({ startAt: tomorrowAt('17:00') }).expect(201);
    await schedule({ startAt: tomorrowAt('17:45') }).expect(201);
    await schedule({ startAt: tomorrowAt('16:15') }).expect(201); // 16:15 a 17:00
  });

  it('a la misma hora en OTRA propiedad no hay conflicto', async () => {
    const other = await createProperty(app, agent, 'Casa en Fisherton');
    await schedule({ startAt: tomorrowAt('17:00') }).expect(201);
    await http(app).post('/visits').set(agent.auth).send({ leadId, propertyId: other.id, startAt: tomorrowAt('17:00') }).expect(201);
  });

  it('una visita cancelada libera el horario, y no se puede reactivar si ya se ocupó', async () => {
    const first = await schedule({ startAt: tomorrowAt('17:00') }).expect(201);
    await http(app).patch(`/visits/${first.body.id}`).set(agent.auth).send({ status: 'cancelada' }).expect(200);
    await schedule({ startAt: tomorrowAt('17:00') }).expect(201);
    await http(app).patch(`/visits/${first.body.id}`).set(agent.auth).send({ status: 'confirmada' }).expect(409);
  });

  it('mover una visita a un horario ocupado se rechaza; a uno libre, no', async () => {
    await schedule({ startAt: tomorrowAt('17:00') }).expect(201);
    const other = await schedule({ startAt: tomorrowAt('19:00') }).expect(201);
    await http(app).patch(`/visits/${other.body.id}`).set(agent.auth).send({ startAt: tomorrowAt('17:15') }).expect(409);
    // Moverla dentro de su propio horario no choca consigo misma
    await http(app).patch(`/visits/${other.body.id}`).set(agent.auth).send({ startAt: tomorrowAt('19:15') }).expect(200);
  });

  it('valida los datos', async () => {
    await schedule({ startAt: 'mañana a la tarde' }).expect(400);
    await schedule({ startAt: tomorrowAt('17:00'), durationMin: 5 }).expect(400);
    await http(app).post('/visits').set(agent.auth).send({ leadId, propertyId: '00000000-0000-4000-8000-000000000000', startAt: tomorrowAt('17:00') }).expect(404);
  });

  describe('agendadas por el asistente de WhatsApp', () => {
    const fromAssistant = (input: { property_id?: unknown; start_iso?: unknown }) =>
      app.get(VisitsService).createFromAssistant(leadId, input);

    it('quedan pendientes y generan un aviso "visita por confirmar"', async () => {
      const visit = await fromAssistant({ property_id: propertyId, start_iso: tomorrowAt('11:00') });
      expect(visit.status).toBe('pendiente');
      const notes = await http(app).get('/notifications').set(agent.auth).expect(200);
      expect(notes.body).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'visita_por_confirmar', leadId })]));
    });

    it('rechaza fechas pasadas y datos inventados por el modelo', async () => {
      await expect(fromAssistant({ property_id: propertyId, start_iso: '2020-01-01T10:00:00-03:00' })).rejects.toThrow('ya pasó');
      await expect(fromAssistant({ property_id: propertyId, start_iso: 'el martes' })).rejects.toThrow('fecha válida');
      await expect(fromAssistant({ property_id: 'depto-centro', start_iso: tomorrowAt('11:00') })).rejects.toThrow('propiedad válida');
      await expect(fromAssistant({ property_id: 42, start_iso: tomorrowAt('11:00') })).rejects.toThrow('propiedad válida');
    });

    it('tampoco puede pisar una visita existente', async () => {
      await schedule({ startAt: tomorrowAt('11:00') }).expect(201);
      await expect(fromAssistant({ property_id: propertyId, start_iso: tomorrowAt('11:20') })).rejects.toThrow('otra visita');
    });
  });

  it('"mis visitas" solo trae las de mis leads', async () => {
    const other = await createUser(app);
    const otherLead = await createLead(app, other);
    await schedule({ startAt: tomorrowAt('10:00') }).expect(201);
    await http(app).post('/visits').set(other.auth).send({ leadId: otherLead.id, propertyId, startAt: tomorrowAt('12:00') }).expect(201);

    const mine = await http(app).get('/visits').query({ mine: 'true' }).set(agent.auth).expect(200);
    expect(mine.body.map((v: { lead: { id: string } }) => v.lead.id)).toEqual([leadId]);
    const all = await http(app).get('/visits').set(agent.auth).expect(200);
    expect(all.body).toHaveLength(2);
  });
});
