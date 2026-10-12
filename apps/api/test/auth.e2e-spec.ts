import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'node:crypto';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { createTestApp, createUser, http, PASSWORD, resetDb } from './helpers';

describe('Autenticación y permisos', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app?.close());

  describe('login', () => {
    it('con email y contraseña correctos devuelve un token que sirve', async () => {
      const user = await createUser(app, UserRole.AGENT, { email: 'Ana@Prueba.test' });
      // El email no distingue mayúsculas ni espacios
      const res = await http(app).post('/auth/login').send({ email: ' ana@prueba.TEST ', password: PASSWORD }).expect(200);
      expect(res.body.user).toMatchObject({ id: user.id, role: 'agent' });
      expect(res.body.user.passwordHash).toBeUndefined();

      const me = await http(app).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
      expect(me.body.email).toBe('ana@prueba.test');
    });

    it('no revela si el email existe: mismo error con contraseña mala o email inexistente', async () => {
      const user = await createUser(app);
      const wrongPassword = await http(app).post('/auth/login').send({ email: user.email, password: 'otra-clave-123' }).expect(401);
      const unknownEmail = await http(app).post('/auth/login').send({ email: 'nadie@prueba.test', password: PASSWORD }).expect(401);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('un usuario desactivado no puede entrar', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const agent = await createUser(app);
      await http(app).patch(`/users/${agent.id}`).set(admin.auth).send({ isActive: false }).expect(200);
      await http(app).post('/auth/login').send({ email: agent.email, password: PASSWORD }).expect(401);
    });
  });

  describe('tokens', () => {
    it('sin token, con basura o firmado con otro secreto: 401', async () => {
      const user = await createUser(app);
      await http(app).get('/auth/me').expect(401);
      await http(app).get('/auth/me').set('Authorization', 'Bearer cualquier-cosa').expect(401);
      const forged = await new JwtService({ secret: 'otro-secreto-que-no-es-el-del-servidor-0123456789' }).signAsync({
        sub: user.id,
        email: user.email,
        role: 'admin',
      });
      await http(app).get('/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('un token sin firma (alg "none") no se acepta', async () => {
      const user = await createUser(app);
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, role: 'admin', iat: Math.floor(Date.now() / 1000) })}.`;
      await http(app).get('/auth/me').set('Authorization', `Bearer ${unsigned}`).expect(401);
    });

    it('desactivar a alguien le corta el acceso al instante, aunque su token no haya vencido', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const agent = await createUser(app);
      await http(app).get('/auth/me').set(agent.auth).expect(200);
      await http(app).patch(`/users/${agent.id}`).set(admin.auth).send({ isActive: false }).expect(200);
      await http(app).get('/auth/me').set(agent.auth).expect(401);
    });

    it('cambiar la contraseña invalida los tokens anteriores', async () => {
      const user = await createUser(app);
      // El "iat" del token tiene precisión de segundos: se espera para que el cambio sea claramente posterior.
      await new Promise((r) => setTimeout(r, 1100));
      const res = await http(app)
        .post('/auth/change-password')
        .set(user.auth)
        .send({ currentPassword: PASSWORD, newPassword: 'clave-nueva-456789' })
        .expect(200);
      await http(app).get('/auth/me').set(user.auth).expect(401);
      await http(app).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('cambiar la contraseña exige la actual', async () => {
      const user = await createUser(app);
      await http(app)
        .post('/auth/change-password')
        .set(user.auth)
        .send({ currentPassword: 'no-es-la-clave', newPassword: 'clave-nueva-456789' })
        .expect(401);
    });
  });

  describe('roles', () => {
    it('un asesor no puede ver ni tocar usuarios; un admin sí', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const agent = await createUser(app);
      await http(app).get('/users').set(agent.auth).expect(403);
      await http(app).patch(`/users/${agent.id}`).set(agent.auth).send({ role: 'admin' }).expect(403);
      await http(app)
        .post('/users')
        .set(agent.auth)
        .send({ email: 'nuevo@prueba.test', password: PASSWORD, fullName: 'Nuevo' })
        .expect(403);

      const list = await http(app).get('/users').set(admin.auth).expect(200);
      expect(list.body).toHaveLength(2);
      for (const u of list.body) expect(u.passwordHash).toBeUndefined();
    });

    it('cualquiera ve el equipo (para elegir asesor), sin datos sensibles', async () => {
      await createUser(app, UserRole.ADMIN);
      const agent = await createUser(app);
      const res = await http(app).get('/users/team').set(agent.auth).expect(200);
      expect(res.body).toHaveLength(2);
      for (const u of res.body) expect(Object.keys(u).sort()).toEqual(['fullName', 'id', 'role']);
    });

    it('sacarle el rol de admin a alguien rige de inmediato con su mismo token', async () => {
      const boss = await createUser(app, UserRole.ADMIN);
      const other = await createUser(app, UserRole.ADMIN);
      await http(app).get('/users').set(other.auth).expect(200);
      await http(app).patch(`/users/${other.id}`).set(boss.auth).send({ role: 'agent' }).expect(200);
      await http(app).get('/users').set(other.auth).expect(403);
    });

    it('un admin no puede desactivarse ni sacarse el rol a sí mismo', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      await http(app).patch(`/users/${admin.id}`).set(admin.auth).send({ isActive: false }).expect(400);
      await http(app).patch(`/users/${admin.id}`).set(admin.auth).send({ role: 'agent' }).expect(400);
    });

    it('no se puede crear un usuario con un email repetido ni con contraseña corta', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      await http(app)
        .post('/users')
        .set(admin.auth)
        .send({ email: admin.email.toUpperCase(), password: PASSWORD, fullName: 'Repetido' })
        .expect(409);
      await http(app).post('/users').set(admin.auth).send({ email: 'corta@prueba.test', password: 'corta', fullName: 'Corta' }).expect(400);
    });
  });

  describe('webhook de WhatsApp', () => {
    const sign = (body: string) => 'sha256=' + createHmac('sha256', 'app-secret-de-prueba').update(body).digest('hex');
    // Solo un cambio de estado (entregado/leído): no dispara al asistente ni sale nada afuera.
    const statusOnly = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.x', status: 'read' }] } }] }] });

    it('la verificación de Meta solo responde con el verify token correcto', async () => {
      const ok = await http(app)
        .get('/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-de-prueba', 'hub.challenge': '12345' })
        .expect(200);
      expect(ok.text).toBe('12345');
      await http(app)
        .get('/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '12345' })
        .expect(403);
    });

    it('rechaza mensajes sin firma o con firma de otro contenido', async () => {
      await http(app).post('/webhooks/whatsapp').set('Content-Type', 'application/json').send(statusOnly).expect(401);
      await http(app)
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign('{"otro":"contenido"}'))
        .send(statusOnly)
        .expect(401);
    });

    it('acepta mensajes firmados con el App Secret', async () => {
      const res = await http(app)
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(statusOnly))
        .send(statusOnly)
        .expect(200);
      expect(res.body).toEqual({ received: true });
    });
  });

  describe('límite de intentos', () => {
    it('después de 5 intentos de login en un minuto responde 429', async () => {
      // App aparte: el contador vive en memoria y los otros tests de login ya sumaron intentos.
      const fresh = await createTestApp();
      try {
        const user = await createUser(fresh);
        for (let i = 0; i < 5; i++) {
          await http(fresh).post('/auth/login').send({ email: user.email, password: 'mala-clave-123' }).expect(401);
        }
        // Ni siquiera con la contraseña correcta: hay que esperar.
        await http(fresh).post('/auth/login').send({ email: user.email, password: PASSWORD }).expect(429);
      } finally {
        await fresh.close();
      }
    });
  });
});
