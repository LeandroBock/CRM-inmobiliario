import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { Lead } from '../src/modules/leads/domain/lead.entity';
import { NotificationsService } from '../src/modules/notifications/application/notifications.service';
import { NotificationType } from '../src/modules/notifications/domain/notification.entity';
import { Mailer, MailMessage } from '../src/modules/notifications/infrastructure/mailer';
import { createLead, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** SMTP simulado: guarda los emails en vez de mandarlos. */
class FakeMailer {
  sent: MailMessage[] = [];
  isConfigured() {
    return true;
  }
  async send(msg: MailMessage) {
    this.sent.push(msg);
    return true;
  }
}

describe('Avisos', () => {
  let app: NestExpressApplication;
  const mailer = new FakeMailer();
  let admin: TestUser;
  let ana: TestUser;
  let beto: TestUser;

  beforeAll(async () => {
    app = await createTestApp([[Mailer, mailer]]);
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await createUser(app, UserRole.ADMIN, { email: 'admin@inmo.test' });
    ana = await createUser(app, UserRole.AGENT, { fullName: 'Ana', email: 'ana@inmo.test' });
    beto = await createUser(app, UserRole.AGENT, { fullName: 'Beto', email: 'beto@inmo.test' });
    mailer.sent = [];
  });
  afterAll(() => app?.close());

  const notify = (type: NotificationType, title: string, body?: string, leadId?: string) =>
    app.get(NotificationsService).notify(type, title, body, leadId);
  /** El email sale en segundo plano (sin frenar el webhook): se espera un momento. */
  const settle = () => new Promise((r) => setTimeout(r, 150));
  const list = async (u: TestUser) => (await http(app).get('/notifications').set(u.auth).expect(200)).body;
  const count = async (u: TestUser) => (await http(app).get('/notifications/unread-count').set(u.auth).expect(200)).body.count;

  describe('en el CRM', () => {
    it('cada asesor ve los avisos de sus leads; los de leads sin asignar los ven todos', async () => {
      const anasLead = await createLead(app, ana);
      const free = await createLead(app, admin);
      await http(app).patch(`/leads/${free.id}/assign`).set(admin.auth).send({ userId: null }).expect(200);

      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', 'Hola?', anasLead.id);
      await notify(NotificationType.LEAD_CALIENTE, 'Lead sin dueño caliente', undefined, free.id);

      expect((await list(ana)).map((n: { title: string }) => n.title).sort()).toEqual(['Juan te escribió', 'Lead sin dueño caliente']);
      expect((await list(beto)).map((n: { title: string }) => n.title)).toEqual(['Lead sin dueño caliente']);
      expect(await count(beto)).toBe(1);
    });

    it('no se puede marcar como leído un aviso ajeno', async () => {
      const lead = await createLead(app, ana);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', undefined, lead.id);
      const [mine] = await list(ana);
      await http(app).patch(`/notifications/${mine.id}/read`).set(beto.auth).expect(404);
      await http(app).patch(`/notifications/${mine.id}/read`).set(ana.auth).expect(204);
      expect(await count(ana)).toBe(0);
    });

    it('"marcar todos como leídos" solo toca los propios', async () => {
      const anasLead = await createLead(app, ana);
      const betosLead = await createLead(app, beto);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Para Ana', undefined, anasLead.id);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Para Beto', undefined, betosLead.id);
      await http(app).post('/notifications/read-all').set(ana.auth).expect(200);
      expect(await count(ana)).toBe(0);
      expect(await count(beto)).toBe(1);
    });

    it('si el lead cambia de asesor, sus avisos sin leer pasan al nuevo', async () => {
      const lead = await createLead(app, ana);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', undefined, lead.id);
      await http(app).patch(`/leads/${lead.id}/assign`).set(ana.auth).send({ userId: beto.id }).expect(200);
      expect((await list(ana)).filter((n: { type: string }) => n.type === 'cliente_esperando')).toEqual([]);
      expect((await list(beto)).map((n: { type: string }) => n.type)).toContain('cliente_esperando');
    });

    it('borrar el lead borra sus avisos', async () => {
      const lead = await createLead(app, ana);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', undefined, lead.id);
      await http(app).delete(`/leads/${lead.id}`).set(ana.auth).expect(204);
      expect(await list(ana)).toEqual([]);
    });
  });

  describe('por email', () => {
    it('le llega al asesor del lead, con link directo al lead', async () => {
      const lead = await createLead(app, ana);
      mailer.sent = [];
      await notify(NotificationType.VISITA_POR_CONFIRMAR, 'Visita por confirmar: Juan', 'Depto Centro · jueves 17 h', lead.id);
      await settle();

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({ to: ['ana@inmo.test'], subject: 'CRM · Visita por confirmar: Juan' });
      expect(mailer.sent[0].text).toContain(`http://localhost:5173/?lead=${lead.id}`);
      expect(mailer.sent[0].html).toContain(`href="http://localhost:5173/?lead=${lead.id}"`);
    });

    it('lo que escribe el cliente no puede inyectar HTML en el email', async () => {
      const lead = await createLead(app, ana);
      mailer.sent = [];
      await notify(NotificationType.CLIENTE_ESPERANDO, '<img src=x onerror=alert(1)> te escribió', '<a href="https://phishing.example">Pagá acá</a>', lead.id);
      await settle();
      expect(mailer.sent[0].html).not.toContain('<img');
      expect(mailer.sent[0].html).not.toContain('<a href="https://phishing');
      expect(mailer.sent[0].html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('quien apagó los emails no los recibe (pero el aviso queda en el CRM)', async () => {
      const lead = await createLead(app, ana);
      await http(app).patch('/auth/me/preferences').set(ana.auth).send({ emailAlerts: false }).expect(200);
      mailer.sent = [];
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', undefined, lead.id);
      await settle();
      expect(mailer.sent).toEqual([]);
      expect(await count(ana)).toBeGreaterThan(0);
    });

    it('lead sin asesor: les llega a los administradores', async () => {
      await createUser(app, UserRole.ADMIN, { email: 'otro-admin@inmo.test' });
      const repo = app.get(DataSource).getRepository(Lead);
      const lead = await repo.save(repo.create({ phone: '+5493410001111' }));
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Nuevo cliente', undefined, lead.id);
      await settle();
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0].to.sort()).toEqual(['admin@inmo.test', 'otro-admin@inmo.test']);
    });

    it('si el cliente sigue escribiendo, se actualiza el aviso pero no llega otro email hasta que lo lea', async () => {
      const lead = await createLead(app, ana);
      mailer.sent = [];
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', 'Hola', lead.id);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', '¿Están?', lead.id);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', 'Sigo esperando', lead.id);
      await settle();
      expect(mailer.sent).toHaveLength(1);
      const waiting = (await list(ana)).filter((n: { type: string }) => n.type === 'cliente_esperando');
      expect(waiting).toHaveLength(1);
      expect(waiting[0].body).toBe('Sigo esperando');

      await http(app).patch(`/notifications/${waiting[0].id}/read`).set(ana.auth).expect(204);
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', 'Volví', lead.id);
      await settle();
      expect(mailer.sent).toHaveLength(2);
    });

    it('a un usuario desactivado no le llegan', async () => {
      const lead = await createLead(app, ana);
      await http(app).patch(`/users/${ana.id}`).set(admin.auth).send({ isActive: false }).expect(200);
      mailer.sent = [];
      await notify(NotificationType.CLIENTE_ESPERANDO, 'Juan te escribió', undefined, lead.id);
      await settle();
      expect(mailer.sent).toEqual([]);
    });
  });
});
