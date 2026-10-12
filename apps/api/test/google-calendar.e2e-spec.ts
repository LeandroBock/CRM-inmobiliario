import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Visit } from '../src/modules/visits/domain/visit.entity';
import { createLead, createProperty, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

interface StoredEvent {
  calendarOwnerToken: string;
  body: { summary: string; location?: string; description?: string; start: { dateTime: string; timeZone: string } };
}

/**
 * Google simulado: se intercepta fetch. OAuth (código → tokens, refresh, revocar) y Calendar API (eventos).
 * Cada usuario conectado tiene su refresh token "rt-<email>" y access tokens "at-<email>-<n>".
 */
class FakeGoogle {
  events = new Map<string, StoredEvent>();
  revoked: string[] = [];
  /** Refresh tokens que Google ya no acepta (el usuario sacó el permiso desde su cuenta). */
  revokedRefresh = new Set<string>();
  /** Access tokens que Google rechaza con 401 (vencidos antes de tiempo). */
  expiredAccess = new Set<string>();
  calendarDown = false;
  calls: string[] = [];
  private n = 0;
  private emailOfToken = new Map<string, string>();

  handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.host}${url.pathname}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.href === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init?.body));
      if (p.get('client_secret') !== 'secreto-cliente') return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const email = p.get('code')!.replace('codigo-de-', '');
        const idToken = `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;
        return json(200, { access_token: this.access(email), expires_in: 3600, refresh_token: `rt-${email}`, id_token: idToken });
      }
      const refresh = p.get('refresh_token')!;
      if (this.revokedRefresh.has(refresh)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: this.access(refresh.replace('rt-', '')), expires_in: 3600 });
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      this.revoked.push(new URLSearchParams(String(init?.body)).get('token')!);
      return new Response(null, { status: 200 });
    }
    if (url.host === 'www.googleapis.com' && url.pathname.startsWith('/calendar/v3/calendars/primary/events')) {
      if (this.calendarDown) return json(503, { error: { message: 'Backend Error' } });
      const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
      if (this.expiredAccess.has(token) || !this.emailOfToken.has(token)) return json(401, { error: { message: 'Invalid Credentials' } });
      const id = url.pathname.split('/events/')[1];
      if (method === 'POST') {
        const newId = `evento${++this.n}`;
        this.events.set(newId, { calendarOwnerToken: this.emailOfToken.get(token)!, body: JSON.parse(String(init!.body)) });
        return json(200, { id: newId });
      }
      const existing = this.events.get(decodeURIComponent(id));
      if (!existing || existing.calendarOwnerToken !== this.emailOfToken.get(token)) return json(404, { error: { message: 'Not Found' } });
      if (method === 'PUT') existing.body = JSON.parse(String(init!.body));
      if (method === 'DELETE') this.events.delete(decodeURIComponent(id));
      return method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, { id });
    }
    throw new Error(`Llamada inesperada a ${url.href}`);
  };

  /** Todos los access tokens emitidos hasta ahora pasan a ser rechazados (401). */
  expireAccessTokens() {
    for (const t of this.emailOfToken.keys()) this.expiredAccess.add(t);
  }

  /** Eventos del calendario de una cuenta. */
  calendarOf(email: string) {
    return [...this.events.entries()].filter(([, e]) => e.calendarOwnerToken === email).map(([id, e]) => ({ id, ...e.body }));
  }

  private access(email: string) {
    const token = `at-${email}-${++this.n}`;
    this.emailOfToken.set(token, email);
    return token;
  }
}

describe('Google Calendar', () => {
  let app: NestExpressApplication;
  const google = new FakeGoogle();
  const realFetch = global.fetch;
  let ana: TestUser;
  let propertyId: string;
  const env = { GOOGLE_CLIENT_ID: 'id-cliente', GOOGLE_CLIENT_SECRET: 'secreto-cliente', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') };

  beforeAll(async () => {
    Object.assign(process.env, env); // se leen al crear la app
    global.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return /googleapis\.com/.test(href) ? google.handle(input, init) : realFetch(input, init);
    }) as typeof fetch;
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    Object.assign(google, { events: new Map(), revoked: [], revokedRefresh: new Set(), expiredAccess: new Set(), calendarDown: false, calls: [] });
    ana = await createUser(app, undefined, { fullName: 'Ana', email: 'ana@inmo.test' });
    propertyId = (await createProperty(app, ana, 'Depto Centro')).id;
  });
  afterAll(async () => {
    await app?.close();
    global.fetch = realFetch;
    for (const k of Object.keys(env)) delete process.env[k];
  });

  /** Hace todo el circuito: /connect → Google → /callback. Devuelve adónde redirigió a la web. */
  async function connect(user: TestUser): Promise<string> {
    const { body } = await http(app).post('/integrations/google/connect').set(user.auth).expect(200);
    const state = new URL(body.url).searchParams.get('state')!;
    const res = await http(app).get('/integrations/google/callback').query({ code: `codigo-de-${user.email}`, state }).expect(302);
    return res.headers.location;
  }
  const db = () => app.get(DataSource);
  const visitRow = (id: string) => db().getRepository(Visit).findOneByOrFail({ id });
  const tomorrow = (h: number) => new Date(Date.now() + 86400_000 + h * 3600_000).toISOString();
  const schedule = (as: TestUser, leadId: string, extra: Record<string, unknown> = {}) =>
    http(app).post('/visits').set(as.auth).send({ leadId, propertyId, startAt: tomorrow(0), ...extra });

  describe('conexión', () => {
    it('conecta la cuenta, guarda el permiso cifrado y lo muestra en el estado', async () => {
      expect((await http(app).get('/integrations/google/status').set(ana.auth)).body).toEqual({ configured: true, connected: false, email: null });
      const { body } = await http(app).post('/integrations/google/connect').set(ana.auth).expect(200);
      const url = new URL(body.url);
      expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.events'); // solo eventos
      expect(url.searchParams.get('access_type')).toBe('offline');

      expect(await connect(ana)).toBe('http://localhost:5173/?google=conectado');
      expect((await http(app).get('/integrations/google/status').set(ana.auth)).body).toEqual({ configured: true, connected: true, email: 'ana@inmo.test' });

      const [row] = await db().query('SELECT refresh_token_enc FROM google_calendar_links');
      expect(row.refresh_token_enc).not.toContain('rt-ana');
    });

    it('rechaza un state adulterado, ajeno o vencido (el callback es público)', async () => {
      const { body } = await http(app).post('/integrations/google/connect').set(ana.auth).expect(200);
      const state = new URL(body.url).searchParams.get('state')!;
      const [payload, sig] = state.split('.');

      // Otro usuario: se cambia el id en el payload pero la firma ya no coincide
      const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), u: '00000000-0000-4000-8000-000000000000' })).toString('base64url');
      const sign = (p: string) => createHmac('sha256', process.env.JWT_SECRET!).update(p).digest('base64url');
      const expired = Buffer.from(JSON.stringify({ u: ana.id, exp: Date.now() - 1000, n: 'x' })).toString('base64url');

      for (const bad of [`${other}.${sig}`, `${payload}.${sig.slice(0, -2)}xx`, `${expired}.${sign(expired)}`, 'basura']) {
        const res = await http(app).get('/integrations/google/callback').query({ code: 'codigo-de-ana@inmo.test', state: bad }).expect(302);
        expect(res.headers.location).toBe('http://localhost:5173/?google=error');
      }
      expect(await db().query('SELECT * FROM google_calendar_links')).toEqual([]);
    });

    it('si el usuario cancela en Google vuelve con "cancelado"', async () => {
      const res = await http(app).get('/integrations/google/callback').query({ error: 'access_denied' }).expect(302);
      expect(res.headers.location).toBe('http://localhost:5173/?google=cancelado');
    });

    it('al conectar copia las visitas activas que ya tenía', async () => {
      const lead = await createLead(app, ana, { fullName: 'Juan Pérez' });
      await schedule(ana, lead.id, { startAt: tomorrow(0) }).expect(201);
      const cancelled = await schedule(ana, lead.id, { startAt: tomorrow(3) }).expect(201);
      await http(app).patch(`/visits/${cancelled.body.id}`).set(ana.auth).send({ status: 'cancelada' }).expect(200);

      await connect(ana);
      expect(google.calendarOf('ana@inmo.test')).toEqual([expect.objectContaining({ summary: 'Visita con Juan Pérez · Depto Centro' })]);
    });

    it('al desconectar se revoca el permiso en Google y el CRM deja de seguir los eventos', async () => {
      await connect(ana);
      const lead = await createLead(app, ana);
      const visit = (await schedule(ana, lead.id).expect(201)).body;
      await http(app).delete('/integrations/google').set(ana.auth).expect(204);

      expect(google.revoked).toEqual(['rt-ana@inmo.test']);
      expect((await http(app).get('/integrations/google/status').set(ana.auth)).body.connected).toBe(false);
      expect((await visitRow(visit.id)).googleEventId).toBeNull();
      expect(google.calendarOf('ana@inmo.test')).toHaveLength(1); // el evento queda en su calendario: es suyo
    });
  });

  describe('sincronización de visitas', () => {
    beforeEach(() => connect(ana));

    it('crea el evento con cliente, teléfono, dirección y horario argentino', async () => {
      const lead = await createLead(app, ana, { fullName: 'Juan Pérez', phone: '341 555-0000' });
      const visit = (await schedule(ana, lead.id, { notes: 'Trae a la pareja' }).expect(201)).body;

      const [event] = google.calendarOf('ana@inmo.test');
      expect(event).toMatchObject({
        summary: 'Visita con Juan Pérez · Depto Centro',
        location: 'Córdoba 1234, Centro, Rosario',
        start: { dateTime: visit.startAt, timeZone: 'America/Argentina/Buenos_Aires' },
      });
      expect(event.description).toContain('Teléfono: +5493415550000');
      expect(event.description).toContain('Notas: Trae a la pareja');
      expect((await visitRow(visit.id)).googleEventId).toBe(event.id);
    });

    it('las pendientes dicen "Por confirmar"; al confirmarla se actualiza', async () => {
      const lead = await createLead(app, ana, { fullName: 'Juan' });
      const visit = (await schedule(ana, lead.id, { status: 'pendiente' }).expect(201)).body;
      expect(google.calendarOf('ana@inmo.test')[0].summary).toBe('Por confirmar: Visita con Juan · Depto Centro');

      await http(app).patch(`/visits/${visit.id}`).set(ana.auth).send({ status: 'confirmada' }).expect(200);
      expect(google.calendarOf('ana@inmo.test')).toEqual([expect.objectContaining({ summary: 'Visita con Juan · Depto Centro' })]);
    });

    it('mover, cancelar y borrar se reflejan en el calendario', async () => {
      const lead = await createLead(app, ana);
      const visit = (await schedule(ana, lead.id).expect(201)).body;
      const moved = tomorrow(5);
      await http(app).patch(`/visits/${visit.id}`).set(ana.auth).send({ startAt: moved }).expect(200);
      expect(google.calendarOf('ana@inmo.test')[0].start.dateTime).toBe(moved);

      await http(app).patch(`/visits/${visit.id}`).set(ana.auth).send({ status: 'cancelada' }).expect(200);
      expect(google.calendarOf('ana@inmo.test')).toEqual([]);

      const other = (await schedule(ana, lead.id).expect(201)).body;
      expect(google.calendarOf('ana@inmo.test')).toHaveLength(1);
      await http(app).delete(`/visits/${other.id}`).set(ana.auth).expect(204);
      expect(google.calendarOf('ana@inmo.test')).toEqual([]);
    });

    it('si el asesor borró el evento a mano, al cambiar la visita se crea de nuevo', async () => {
      const lead = await createLead(app, ana);
      const visit = (await schedule(ana, lead.id).expect(201)).body;
      google.events.clear();
      await http(app).patch(`/visits/${visit.id}`).set(ana.auth).send({ notes: 'cambio' }).expect(200);
      expect(google.calendarOf('ana@inmo.test')).toHaveLength(1);
    });

    it('al pasarle el lead a otro asesor, las visitas se mudan a su calendario', async () => {
      const beto = await createUser(app, undefined, { fullName: 'Beto', email: 'beto@inmo.test' });
      await connect(beto);
      const lead = await createLead(app, ana);
      await schedule(ana, lead.id).expect(201);

      await http(app).patch(`/leads/${lead.id}/assign`).set(ana.auth).send({ userId: beto.id }).expect(200);
      expect(google.calendarOf('ana@inmo.test')).toEqual([]);
      expect(google.calendarOf('beto@inmo.test')).toHaveLength(1);
    });

    it('a un asesor sin calendario conectado: se saca del anterior y listo', async () => {
      const carla = await createUser(app, undefined, { fullName: 'Carla' });
      const lead = await createLead(app, ana);
      const visit = (await schedule(ana, lead.id).expect(201)).body;
      await http(app).patch(`/leads/${lead.id}/assign`).set(ana.auth).send({ userId: carla.id }).expect(200);
      expect(google.calendarOf('ana@inmo.test')).toEqual([]);
      expect((await visitRow(visit.id)).googleEventId).toBeNull();
    });

    it('si Google rechaza el token (401), pide uno nuevo y reintenta', async () => {
      const lead = await createLead(app, ana);
      google.expireAccessTokens();

      await schedule(ana, lead.id).expect(201);
      expect(google.calendarOf('ana@inmo.test')).toHaveLength(1);
    });

    it('si el usuario sacó el permiso desde Google, se desconecta solo y la visita se guarda igual', async () => {
      const lead = await createLead(app, ana);
      google.expireAccessTokens();
      google.revokedRefresh.add('rt-ana@inmo.test');

      const visit = (await schedule(ana, lead.id).expect(201)).body;
      expect((await visitRow(visit.id)).googleEventId).toBeNull();
      expect((await http(app).get('/integrations/google/status').set(ana.auth)).body.connected).toBe(false);
    });

    it('si Google está caído, la visita se guarda igual y se sincroniza en el próximo cambio', async () => {
      const lead = await createLead(app, ana);
      google.calendarDown = true;
      const visit = (await schedule(ana, lead.id).expect(201)).body;
      expect((await visitRow(visit.id)).googleEventId).toBeNull();

      google.calendarDown = false;
      await http(app).patch(`/visits/${visit.id}`).set(ana.auth).send({ notes: 'reintento' }).expect(200);
      expect(google.calendarOf('ana@inmo.test')).toHaveLength(1);
    });

    it('borrar el lead borra los eventos de sus visitas', async () => {
      const lead = await createLead(app, ana);
      await schedule(ana, lead.id).expect(201);
      await http(app).delete(`/leads/${lead.id}`).set(ana.auth).expect(204);
      expect(google.calendarOf('ana@inmo.test')).toEqual([]);
    });
  });
});
