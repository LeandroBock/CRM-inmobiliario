import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { todayAr } from '../src/modules/rentals/application/index.service';
import { RentalsService } from '../src/modules/rentals/application/rentals.service';
import { addMonths, monthOf } from '../src/modules/rentals/domain/rent-calc';
import { IndexSources } from '../src/modules/rentals/infrastructure/index-sources';
import { createProperty, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** BCRA e INDEC simulados: devuelven lo que se cargue en `iclValues` / `ipcValues`. */
class FakeSources {
  iclValues: Record<string, number> = {};
  ipcValues: Record<string, number> = {};
  fail = false;
  async icl(from: string, to: string) {
    if (this.fail) throw new Error('api.bcra.gob.ar respondió 503');
    return Object.entries(this.iclValues).filter(([d]) => d >= from && d <= to).map(([date, value]) => ({ date, value }));
  }
  async ipc(fromMonth: string) {
    return Object.entries(this.ipcValues).filter(([d]) => d >= fromMonth).map(([date, value]) => ({ date, value }));
  }
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('Alquileres', () => {
  let app: NestExpressApplication;
  const sources = new FakeSources();
  let admin: TestUser;
  let agent: TestUser;
  const today = todayAr();

  beforeAll(async () => {
    app = await createTestApp([[IndexSources, sources]]);
  });
  beforeEach(async () => {
    await resetDb(app);
    await app.get(DataSource).query('TRUNCATE index_values');
    sources.iclValues = {};
    sources.ipcValues = {};
    sources.fail = false;
    admin = await createUser(app, UserRole.ADMIN, { fullName: 'Admin' });
    agent = await createUser(app, UserRole.AGENT, { fullName: 'Ana' });
  });
  afterAll(() => app?.close());

  async function contract(overrides: Record<string, unknown> = {}) {
    const property = await createProperty(app, agent, 'Depto Centro');
    const res = await http(app)
      .post('/rentals')
      .set(agent.auth)
      .send({
        propertyId: property.id,
        tenantName: ' Juan Pérez ',
        tenantPhone: '+5493415550000',
        tenantEmail: '',
        ownerName: 'María Gómez',
        startDate: addMonths(today, -4),
        endDate: addMonths(today, 20),
        initialRent: 500000,
        paymentDueDay: 10,
        adjustmentIndex: 'icl',
        adjustmentEveryMonths: 4,
        ...overrides,
      })
      .expect(201);
    return res.body;
  }
  const get = async (id: string) => (await http(app).get(`/rentals/${id}`).set(agent.auth).expect(200)).body;
  const notifications = async () => (await http(app).get('/notifications').set(admin.auth).expect(200)).body as { type: string; title: string; body: string; readAt: string | null }[];

  it('crea el contrato: limpia datos y calcula el próximo ajuste', async () => {
    const c = await contract();
    expect(c).toMatchObject({ tenantName: 'Juan Pérez', tenantEmail: null, currentRent: 500000, lastAdjustmentDate: addMonths(today, -4), nextAdjustmentDate: today, status: 'activo' });
    const list = (await http(app).get('/rentals?q=juan').set(agent.auth).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].contract.property.title).toBe('Depto Centro');
  });

  it('contrato que ya venía de antes: los meses hasta la fecha indicada quedan pagos', async () => {
    const start = addMonths(monthOf(today), -3);
    const c = await contract({ startDate: addDays(start, 14), endDate: addMonths(today, 20), paidThrough: monthOf(today), adjustmentIndex: 'fijo', fixedRatePct: 5, adjustmentEveryMonths: 12 });
    const detail = await get(c.id);
    expect(detail.payments).toHaveLength(4);
    expect(detail.payments.every((p: { method: string; amount: number }) => p.method === 'Carga inicial' && p.amount === 500000)).toBe(true);
    expect(detail.debt).toBe(0);
    // el primer mes vence el día de inicio (el 15), no el 10
    expect(detail.periods.at(-1)).toMatchObject({ period: start, dueDate: addDays(start, 14) });
  });

  it('valida: fechas, porcentaje fijo, día de pago', async () => {
    const property = await createProperty(app, agent);
    const base = { propertyId: property.id, tenantName: 'A', ownerName: 'B', initialRent: 1000, adjustmentEveryMonths: 3 };
    expect((await http(app).post('/rentals').set(agent.auth).send({ ...base, startDate: '2026-10-01', endDate: '2026-09-01', adjustmentIndex: 'icl' }).expect(400)).body.message).toMatch(/fin tiene que ser posterior/);
    expect((await http(app).post('/rentals').set(agent.auth).send({ ...base, startDate: '2026-10-01', endDate: '2028-10-01', adjustmentIndex: 'fijo' }).expect(400)).body.message).toMatch(/porcentaje/);
    await http(app).post('/rentals').set(agent.auth).send({ ...base, startDate: '2026-10-01', endDate: '2028-10-01', adjustmentIndex: 'icl', paymentDueDay: 31 }).expect(400);
  });

  it('ajuste por ICL: calcula con los valores del BCRA, aplica, avanza la fecha y se puede deshacer', async () => {
    const c = await contract();
    sources.iclValues = { [addMonths(today, -4)]: 32, [today]: 36.86 };
    await http(app).post('/rentals/indexes/sync').set(admin.auth).expect(200);

    const before = await get(c.id);
    expect(before.nextAdjustment).toMatchObject({ date: today, ok: true, canApply: true, factor: 1.151875, newRent: 575938 });

    const applied = await http(app).post(`/rentals/${c.id}/adjustments`).set(agent.auth).send({}).expect(201);
    expect(applied.body).toMatchObject({ previousRent: 500000, newRent: 575938, index: 'icl', authorName: 'Ana' });
    const after = await get(c.id);
    expect(after).toMatchObject({ currentRent: 575938, lastAdjustmentDate: today, nextAdjustmentDate: addMonths(today, 4) });
    expect(after.adjustments).toHaveLength(1);

    await http(app).delete(`/rentals/${c.id}/adjustments/last`).set(agent.auth).expect(204);
    expect(await get(c.id)).toMatchObject({ currentRent: 500000, nextAdjustmentDate: today, adjustments: [] });
  });

  it('no deja aplicar un ajuste con más de 30 días de anticipación', async () => {
    const c = await contract({ startDate: addDays(today, -10), endDate: addMonths(today, 24), adjustmentIndex: 'fijo', fixedRatePct: 10, adjustmentEveryMonths: 6 });
    const res = await http(app).post(`/rentals/${c.id}/adjustments`).set(agent.auth).send({}).expect(409);
    expect(res.body.message).toMatch(/se puede aplicar desde 30 días antes/);
  });

  it('IPC que todavía no está en la API: lo carga un admin a mano y se aplica', async () => {
    const c = await contract({ adjustmentIndex: 'ipc' });
    const end = addMonths(monthOf(today), -1);
    const start = addMonths(end, -4);
    sources.ipcValues = { [start]: 100 }; // falta el último mes
    await http(app).post('/rentals/indexes/sync').set(admin.auth).expect(200);
    expect((await get(c.id)).nextAdjustment).toMatchObject({ ok: false });

    await http(app).post('/rentals/indexes').set(agent.auth).send({ index: 'ipc', date: end, value: 110 }).expect(403);
    await http(app).post('/rentals/indexes').set(admin.auth).send({ index: 'ipc', date: addDays(end, 14), value: 110 }).expect(201);
    expect((await get(c.id)).nextAdjustment).toMatchObject({ ok: true, factor: 1.1, newRent: 550000 });

    // La API no pisa lo cargado a mano
    sources.ipcValues = { [start]: 100, [end]: 999 };
    await http(app).post('/rentals/indexes/sync').set(admin.auth).expect(200);
    expect((await get(c.id)).nextAdjustment).toMatchObject({ newRent: 550000 });
  });

  it('sin índice: hay que poner el monto a mano', async () => {
    const c = await contract({ adjustmentIndex: 'ninguno' });
    expect((await http(app).post(`/rentals/${c.id}/adjustments`).set(agent.auth).send({}).expect(400)).body.message).toMatch(/nuevo monto/);
    const res = await http(app).post(`/rentals/${c.id}/adjustments`).set(agent.auth).send({ newRent: 620000 }).expect(201);
    expect(res.body).toMatchObject({ newRent: 620000, factor: 1.24, detail: { manual: true } });
  });

  it('pagos: deuda por mes, aviso de deuda y se resuelve al pagar', async () => {
    const c = await contract({ startDate: addMonths(monthOf(today), -2), endDate: addMonths(monthOf(today), 22), adjustmentIndex: 'fijo', fixedRatePct: 5, adjustmentEveryMonths: 6 });
    const m0 = addMonths(monthOf(today), -2);
    const m1 = addMonths(monthOf(today), -1);
    await http(app).post(`/rentals/${c.id}/payments`).set(agent.auth).send({ period: m0, amount: 500000, paidAt: addDays(m0, 5), method: 'transferencia' }).expect(201);
    await http(app).post(`/rentals/${c.id}/payments`).set(agent.auth).send({ period: m1, amount: 200000, paidAt: addDays(m1, 5) }).expect(201);
    // el mes en curso, pago (así no depende de qué día del mes corre el test)
    await http(app).post(`/rentals/${c.id}/payments`).set(agent.auth).send({ period: monthOf(today), amount: 500000, paidAt: today }).expect(201);

    const detail = await get(c.id);
    expect(detail.debt).toBe(300000);
    expect(detail.periods.find((p: { period: string }) => p.period === m1)).toMatchObject({ due: 500000, paid: 200000, balance: 300000, overdue: true });
    const debt = (await notifications()).find((n) => n.type === 'alquiler_deuda');
    expect(debt).toMatchObject({ title: 'Alquiler impago: Depto Centro', body: 'Juan Pérez debe $ 300.000 (1 mes).' });

    const pay = await http(app).post(`/rentals/${c.id}/payments`).set(agent.auth).send({ period: m1, amount: 300000, paidAt: today }).expect(201);
    expect((await get(c.id)).debt).toBe(0);
    expect((await notifications()).find((n) => n.type === 'alquiler_deuda')?.readAt).not.toBeNull();

    await http(app).delete(`/rentals/${c.id}/payments/${pay.body.id}`).set(agent.auth).expect(204);
    expect((await get(c.id)).debt).toBe(300000);
    await http(app).post(`/rentals/${c.id}/payments`).set(agent.auth).send({ period: addMonths(m0, -3), amount: 1, paidAt: today }).expect(400);
  });

  it('control diario: avisa el ajuste y el vencimiento, aunque falle el BCRA', async () => {
    await contract({ endDate: addDays(today, 40), adjustmentIndex: 'icl' });
    sources.fail = true;
    await app.get(RentalsService).dailyCheck(today);
    const list = await notifications();
    expect(list.find((n) => n.type === 'alquiler_ajuste')).toMatchObject({ title: 'Ajuste de alquiler: Depto Centro' });
    expect(list.find((n) => n.type === 'alquiler_ajuste')!.body).toMatch(/no se puede calcular/);
    expect(list.find((n) => n.type === 'alquiler_vence')!.body).toMatch(/Juan Pérez y María Gómez/);
    // Al día siguiente no se repiten
    await app.get(RentalsService).dailyCheck(today);
    expect((await notifications()).filter((n) => n.type === 'alquiler_ajuste')).toHaveLength(1);
  });

  it('no se puede borrar una propiedad con contrato; borrar el contrato es solo para admin', async () => {
    const c = await contract();
    expect((await http(app).delete(`/properties/${c.property.id}`).set(admin.auth).expect(409)).body.message).toMatch(/contratos de alquiler/);
    await http(app).delete(`/rentals/${c.id}`).set(agent.auth).expect(403);
    await http(app).delete(`/rentals/${c.id}`).set(admin.auth).expect(204);
    await http(app).delete(`/properties/${c.property.id}`).set(admin.auth).expect(204);
  });
});

describe('Fuentes de índices (BCRA y datos.gob.ar simulados)', () => {
  let server: Server;
  const seen: string[] = [];
  let sources: IndexSources;
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.url!);
      const url = new URL(req.url!, 'http://x');
      const json = (data: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      if (url.pathname === '/estadisticas/v4.0/Monetarias/40') {
        const offset = Number(url.searchParams.get('offset'));
        const count = offset === 0 ? 1000 : 2;
        return json({ status: 200, results: [{ idVariable: 40, detalle: Array.from({ length: count }, (_, i) => ({ fecha: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, valor: 30 + i / 1000 })) }] });
      }
      if (url.pathname === '/series/api/series/') return json({ data: [['2026-06-01', 11826.4103], ['2026-07-01', 12076.3937], ['2026-08-01', null]] });
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    sources = new IndexSources(new ConfigService({ BCRA_API_URL: base, SERIES_API_URL: `${base}/series/api` }));
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('ICL: pide de a 1000 y sigue paginando', async () => {
    const points = await sources.icl('2020-07-01', '2026-10-15');
    expect(points).toHaveLength(1002);
    expect(seen.filter((u) => u.includes('Monetarias/40'))).toEqual([
      '/estadisticas/v4.0/Monetarias/40?desde=2020-07-01&hasta=2026-10-15&limit=1000&offset=0',
      '/estadisticas/v4.0/Monetarias/40?desde=2020-07-01&hasta=2026-10-15&limit=1000&offset=1000',
    ]);
  });

  it('IPC: la serie del INDEC, sin los meses vacíos', async () => {
    expect(await sources.ipc('2026-06-01')).toEqual([
      { date: '2026-06-01', value: 11826.4103 },
      { date: '2026-07-01', value: 12076.3937 },
    ]);
    expect(seen.at(-1)).toBe('/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&start_date=2026-06-01&limit=1000&format=json');
  });
});
