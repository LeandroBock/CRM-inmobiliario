import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { UsersService } from '../src/modules/auth/application/users.service';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';

export const PASSWORD = 'clave-de-prueba-123';

/** La API completa, configurada igual que en main.ts. `overrides` reemplaza servicios externos por dobles. */
export async function createTestApp(overrides: [token: unknown, fake: unknown][] = []): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const [token, fake] of overrides) builder = builder.overrideProvider(token).useValue(fake);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** Vacía todas las tablas (cada test arranca de cero). */
export async function resetDb(app: NestExpressApplication): Promise<void> {
  const db = app.get(DataSource);
  const tables: { tablename: string }[] = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('spatial_ref_sys', 'migrations')",
  );
  if (tables.length) await db.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  /** Headers listos para supertest: .set(user.auth) */
  auth: { Authorization: string };
}

let counter = 0;

/** Crea un usuario y le firma un token como lo hace el login (sin pasar por el límite de 5 intentos por minuto). */
export async function createUser(
  app: NestExpressApplication,
  role: UserRole = UserRole.AGENT,
  overrides: { fullName?: string; email?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `usuario${counter}-${Date.now()}@prueba.test`;
  const user = await app.get(UsersService).create({ email, password: PASSWORD, fullName: overrides.fullName ?? `Usuario ${counter}`, role });
  const token = await app.get(JwtService).signAsync({ sub: user.id, email: user.email, role: user.role });
  return { id: user.id, email: user.email, token, auth: { Authorization: `Bearer ${token}` } };
}

export const http = (app: NestExpressApplication) => request(app.getHttpServer());

/** Propiedad mínima. Con priceUsd y fxRate no se consulta la cotización por internet. */
export async function createProperty(app: NestExpressApplication, user: TestUser, title = 'Depto 2 amb. Centro') {
  const res = await http(app)
    .post('/properties')
    .set(user.auth)
    .send({
      title,
      type: 'departamento',
      address: 'Córdoba 1234',
      neighborhood: 'Centro',
      city: 'Rosario',
      province: 'Santa Fe',
      coveredM2: 50,
      totalM2: 55,
      priceUsd: 80_000,
      fxRate: 1_200,
    })
    .expect(201);
  return res.body as { id: string };
}

export async function createLead(app: NestExpressApplication, user: TestUser, data: Record<string, unknown> = {}) {
  counter += 1;
  const res = await http(app)
    .post('/leads')
    .set(user.auth)
    .send({ fullName: `Cliente ${counter}`, phone: `341 555-${String(1000 + counter).slice(-4)}`, ...data })
    .expect(201);
  return res.body as { id: string; phone: string; assignedTo?: { id: string; fullName: string } | null; stage: string };
}
