import { ServiceUnavailableException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { FxService } from '../src/modules/properties/application/fx.service';
import { FxSource } from '../src/modules/properties/domain/property.enums';
import { createLead, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Cotizaciones simuladas (DolarApi no se consulta en los tests). */
class FakeFx {
  rates: Record<string, number> = { blue: 1300, oficial: 1000, mep: 1250, ccl: 1280 };
  down = false;
  async getRate(source: FxSource) {
    if (this.down) throw new ServiceUnavailableException(`No pude obtener la cotización del dólar ${source} en este momento.`);
    return { rate: this.rates[source], date: '2026-10-12' };
  }
}

/** Servicio de tasación (Python) simulado con un servidor HTTP de verdad: se prueba el cliente HTTP real. */
class FakeAvm {
  received: Record<string, unknown>[] = [];
  status = 200;
  private server!: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url !== '/predict') return res.writeHead(404).end();
        this.received.push(JSON.parse(body));
        if (this.status !== 200) return res.writeHead(this.status, { 'Content-Type': 'application/json' }).end('{"detail":"Modelo no entrenado"}');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            estimated_price_usd: 95000,
            range_low_usd: 88000,
            range_high_usd: 102000,
            projected_price_3y_usd: 110000,
            appreciation_3y_pct: 15.8,
            confidence: 0.82,
            model_version: 'xgb-test',
          }),
        );
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }
}

const base = {
  title: 'Depto 2 amb. Centro',
  type: 'departamento',
  operation: 'venta',
  address: 'Córdoba 1234',
  neighborhood: 'Centro',
  city: 'Rosario',
  province: 'Santa Fe',
  coveredM2: 50,
  totalM2: 55,
  rooms: 2,
};

describe('Propiedades y tasación', () => {
  let app: NestExpressApplication;
  const fx = new FakeFx();
  const avm = new FakeAvm();
  let user: TestUser;
  const previousAvmUrl = process.env.AVM_SERVICE_URL;

  beforeAll(async () => {
    process.env.AVM_SERVICE_URL = await avm.start(); // se lee al crear la app
    app = await createTestApp([[FxService, fx]]);
  });
  beforeEach(async () => {
    await resetDb(app);
    fx.down = false;
    avm.received = [];
    avm.status = 200;
    user = await createUser(app);
  });
  afterAll(async () => {
    await app?.close();
    await avm.stop();
    process.env.AVM_SERVICE_URL = previousAvmUrl;
  });

  const create = (data: Record<string, unknown>) => http(app).post('/properties').set(user.auth).send({ ...base, ...data });

  describe('precios en dos monedas', () => {
    it('con precio en USD calcula los pesos con el dólar blue del día', async () => {
      const res = await create({ priceUsd: 80000 }).expect(201);
      expect(res.body).toMatchObject({ priceUsd: 80000, priceArs: 104_000_000, fxRate: 1300, fxSource: 'blue', fxRateDate: '2026-10-12' });
    });

    it('con precio en pesos deriva los USD (el USD es la fuente de verdad)', async () => {
      const res = await create({ priceArs: 130_000_000, fxSource: 'oficial' }).expect(201);
      expect(res.body).toMatchObject({ priceUsd: 130000, priceArs: 130_000_000, fxRate: 1000, fxSource: 'oficial' });
    });

    it('con cotización manual no consulta DolarApi (sirve aunque esté caída)', async () => {
      fx.down = true;
      const res = await create({ priceUsd: 50000, fxRate: 1500 }).expect(201);
      expect(res.body).toMatchObject({ priceArs: 75_000_000, fxRate: 1500 });
    });

    it('si DolarApi está caída y no hay cotización manual, lo explica', async () => {
      fx.down = true;
      const res = await create({ priceUsd: 50000 }).expect(503);
      expect(res.body.message).toMatch(/cotización/);
    });

    it('sin precio no se puede cargar', async () => {
      const res = await create({}).expect(400);
      expect(res.body.message).toMatch(/priceUsd o priceArs/);
    });

    it('cambiar el precio recalcula los pesos con el dólar del día; cambiar otra cosa no los toca', async () => {
      const { body } = await create({ priceUsd: 80000, fxRate: 1200 }).expect(201);
      const renamed = await http(app).patch(`/properties/${body.id}`).set(user.auth).send({ title: 'Depto reciclado' }).expect(200);
      expect(renamed.body).toMatchObject({ title: 'Depto reciclado', priceUsd: 80000, fxRate: 1200, rooms: 2 });

      const repriced = await http(app).patch(`/properties/${body.id}`).set(user.auth).send({ priceUsd: 90000 }).expect(200);
      // Los pesos se recalculan con la cotización del día (como en el refresco diario)
      expect(repriced.body).toMatchObject({ priceUsd: 90000, priceArs: 117_000_000, fxRate: 1300 });
    });

    it('el refresco diario actualiza los pesos de las disponibles con la cotización nueva', async () => {
      const available = (await create({ priceUsd: 100000 }).expect(201)).body;
      const sold = (await create({ priceUsd: 100000, status: 'vendida' }).expect(201)).body;
      fx.rates.blue = 1400;
      try {
        await http(app).post('/properties/refresh-fx').set(user.auth).expect(200);
      } finally {
        fx.rates.blue = 1300;
      }
      expect((await http(app).get(`/properties/${available.id}`).set(user.auth)).body).toMatchObject({ priceArs: 140_000_000, fxRate: 1400 });
      expect((await http(app).get(`/properties/${sold.id}`).set(user.auth)).body).toMatchObject({ priceArs: 130_000_000, fxRate: 1300 });
    });
  });

  describe('búsqueda', () => {
    it('filtra por precio, ambientes, barrio y texto', async () => {
      await create({ title: 'Monoambiente', rooms: 1, priceUsd: 45000 });
      await create({ title: 'Depto 3 amb', rooms: 3, priceUsd: 120000, neighborhood: 'Echesortu' });
      await create({ title: 'Casa grande', type: 'casa', rooms: 5, priceUsd: 250000, address: 'Wilde 900' });

      const titles = async (query: Record<string, unknown>) =>
        (await http(app).get('/properties').query(query).set(user.auth).expect(200)).body.items.map((p: { title: string }) => p.title).sort();
      expect(await titles({ maxPriceUsd: 130000 })).toEqual(['Depto 3 amb', 'Monoambiente']);
      expect(await titles({ minRooms: 3 })).toEqual(['Casa grande', 'Depto 3 amb']);
      expect(await titles({ neighborhood: 'echesortu' })).toEqual(['Depto 3 amb']);
      expect(await titles({ q: 'wilde' })).toEqual(['Casa grande']);
      expect(await titles({ type: 'casa' })).toEqual(['Casa grande']);
    });

    it('busca por cercanía (PostGIS) y ordena por distancia', async () => {
      // Monumento a la Bandera (Rosario) y dos puntos a ~1 km y ~5 km
      await create({ title: 'A 1 km', lat: -32.9385, lng: -60.6215, priceUsd: 1 });
      await create({ title: 'Junto al Monumento', lat: -32.9477, lng: -60.6304, priceUsd: 1 });
      await create({ title: 'A 5 km', lat: -32.9900, lng: -60.6600, priceUsd: 1 });
      await create({ title: 'Sin ubicación', priceUsd: 1 });

      const res = await http(app).get('/properties').query({ lat: -32.9477, lng: -60.6304, radiusM: 2000 }).set(user.auth).expect(200);
      expect(res.body.items.map((p: { title: string }) => p.title)).toEqual(['Junto al Monumento', 'A 1 km']);
    });

    it('la ubicación se cambia con lat y lng juntos', async () => {
      const { body } = await create({ priceUsd: 1, lat: -32.95, lng: -60.63 }).expect(201);
      await http(app).patch(`/properties/${body.id}`).set(user.auth).send({ lat: -32.9 }).expect(400);
    });
  });

  it('valida los links de fotos', async () => {
    await create({ priceUsd: 1, photoUrls: ['javascript:alert(1)'] }).expect(400);
    await create({ priceUsd: 1, photoUrls: ['https://fotos.example.com/1.jpg'] }).expect(201);
  });

  it('borrar una propiedad borra sus visitas', async () => {
    const { body: property } = await create({ priceUsd: 1 }).expect(201);
    const lead = await createLead(app, user);
    await http(app)
      .post('/visits')
      .set(user.auth)
      .send({ leadId: lead.id, propertyId: property.id, startAt: new Date(Date.now() + 86400_000).toISOString() })
      .expect(201);
    await http(app).delete(`/properties/${property.id}`).set(user.auth).expect(204);
    expect((await http(app).get('/visits').set(user.auth).expect(200)).body).toEqual([]);
    await http(app).get(`/properties/${property.id}`).set(user.auth).expect(404);
  });

  describe('tasación (AVM)', () => {
    it('completa los datos desde la propiedad, guarda la tasación y queda en el historial', async () => {
      const { body: property } = await create({ priceUsd: 90000, lat: -32.95, lng: -60.63, garageSpots: 1, amenities: ['pileta'] }).expect(201);
      const res = await http(app).post('/avo/appraise').set(user.auth).send({ propertyId: property.id, ageYears: 10 }).expect(201);

      expect(avm.received[0]).toEqual({
        neighborhood: 'Centro',
        city: 'Rosario',
        property_type: 'departamento',
        covered_m2: 50,
        total_m2: 55,
        rooms: 2,
        bathrooms: 0,
        garage_spots: 1,
        age_years: 10, // lo del pedido gana sobre lo guardado
        lat: -32.95,
        lng: -60.63,
        amenities: ['pileta'],
      });
      expect(res.body).toMatchObject({ estimatedPriceUsd: 95000, pricePerM2Usd: 1900, rangeLowUsd: 88000, rangeHighUsd: 102000, modelVersion: 'xgb-test' });

      const history = await http(app).get(`/avo/properties/${property.id}/history`).set(user.auth).expect(200);
      expect(history.body).toHaveLength(1);
    });

    it('tasa sin propiedad guardada con los datos del pedido', async () => {
      await http(app).post('/avo/appraise').set(user.auth).send({ neighborhood: 'Fisherton', type: 'casa', coveredM2: 120, totalM2: 300 }).expect(201);
      expect(avm.received[0]).toMatchObject({ neighborhood: 'Fisherton', property_type: 'casa', covered_m2: 120 });
    });

    it('si el servicio de tasación falla (p. ej. sin modelo entrenado) responde 502 con un mensaje claro', async () => {
      avm.status = 503;
      const res = await http(app).post('/avo/appraise').set(user.auth).send({ neighborhood: 'Centro', coveredM2: 50 }).expect(502);
      expect(res.body.message).toMatch(/servicio de tasación no está disponible/);
    });

    it('con una propiedad que no existe: 404', async () => {
      await http(app).post('/avo/appraise').set(user.auth).send({ propertyId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      expect(avm.received).toHaveLength(0);
    });

    it('promedio de USD/m² por barrio, solo con las disponibles', async () => {
      await create({ priceUsd: 100000, coveredM2: 50 }); // 2000/m²
      await create({ priceUsd: 150000, coveredM2: 50 }); // 3000/m²
      await create({ priceUsd: 999999, coveredM2: 50, status: 'vendida' });
      const res = await http(app).get('/avo/market/neighborhoods').set(user.auth).expect(200);
      expect(res.body).toEqual([{ neighborhood: 'Centro', avgUsdM2: 2500, listings: 2 }]);
    });
  });

  describe('tasación por comparables', () => {
    // Alrededor del Monumento a la Bandera (Rosario). ~0,001° de latitud ≈ 111 m.
    const near = (i: number) => ({ lat: -32.9477 + i * 0.001, lng: -60.6304 });
    const comps = (body: Record<string, unknown>) => http(app).post('/avo/comparables').set(user.auth).send(body);

    it('usa las cercanas del mismo tipo y tamaño parecido, y explica cómo las eligió', async () => {
      // 6 deptos de ~50 m² a menos de 1 km, entre 1.900 y 2.150 USD/m²
      for (const [i, usd] of [95000, 97500, 100000, 100000, 102500, 107500].entries()) {
        await create({ title: `Comparable ${i}`, coveredM2: 50, priceUsd: usd, ...near(i) }).expect(201);
      }
      await create({ title: 'Lejos', coveredM2: 50, priceUsd: 300000, lat: -32.99, lng: -60.70 }).expect(201); // ~10 km
      await create({ title: 'Casa', type: 'casa', coveredM2: 50, priceUsd: 300000, ...near(1) }).expect(201);
      await create({ title: 'Muy grande', coveredM2: 200, priceUsd: 300000, ...near(1) }).expect(201);
      await create({ title: 'Pausada', status: 'pausada', coveredM2: 50, priceUsd: 300000, ...near(1) }).expect(201);
      await create({ title: 'Alquiler', operation: 'alquiler', coveredM2: 50, priceUsd: 500, ...near(1) }).expect(201);
      const target = (await create({ title: 'A tasar', coveredM2: 60, priceUsd: 1, ...near(0) }).expect(201)).body;

      const res = await comps({ propertyId: target.id }).expect(200);
      expect(res.body.comparables.map((c: { title: string }) => c.title)).toEqual([
        'Comparable 0', 'Comparable 1', 'Comparable 2', 'Comparable 3', 'Comparable 4', 'Comparable 5',
      ]); // ordenadas por distancia; sin la propia propiedad
      expect(res.body.estimate).toMatchObject({ pricePerM2Usd: 2000, estimatedPriceUsd: 120_000, used: 6 });
      expect(res.body.criteria).toBe('6 departamentos en venta, a menos de 1 km, de 42 a 84 m² cubiertos, publicadas en los últimos 24 meses');
      expect(res.body.comparables[0].distanceM).toBeLessThan(50);
      expect(res.body.warning).toBeNull();
    });

    it('sin ubicación, busca en el mismo barrio (sin importar mayúsculas)', async () => {
      for (const usd of [90000, 100000, 110000, 100000, 100000]) await create({ coveredM2: 50, priceUsd: usd, neighborhood: 'Echesortu' }).expect(201);
      await create({ coveredM2: 50, priceUsd: 500000, neighborhood: 'Fisherton' }).expect(201);
      const res = await comps({ type: 'departamento', neighborhood: 'echesortu', coveredM2: 50 }).expect(200);
      expect(res.body.comparables).toHaveLength(5);
      expect(res.body.estimate.estimatedPriceUsd).toBe(100_000);
      expect(res.body.criteria).toContain('en el mismo barrio');
    });

    it('si hay pocas cerca, amplía la búsqueda y lo avisa', async () => {
      for (const i of [0, 1, 2]) await create({ coveredM2: 50, priceUsd: 100000, ...near(i) }).expect(201);
      for (const i of [15, 16, 17]) await create({ coveredM2: 50, priceUsd: 100000, ...near(i) }).expect(201); // ~1,7 km
      const res = await comps({ type: 'departamento', coveredM2: 50, ...near(0) }).expect(200);
      expect(res.body.comparables).toHaveLength(6);
      expect(res.body.warning).toMatch(/se amplió la búsqueda \(a menos de 2 km\)/);
    });

    it('marca las publicaciones con precios fuera de lo normal y no las usa', async () => {
      for (const usd of [100000, 98000, 102000, 99000, 101000]) await create({ coveredM2: 50, priceUsd: usd, neighborhood: 'Centro' }).expect(201);
      await create({ title: 'Mal cargada', coveredM2: 50, priceUsd: 1_000_000, neighborhood: 'Centro' }).expect(201);
      const res = await comps({ type: 'departamento', neighborhood: 'Centro', coveredM2: 50 }).expect(200);
      expect(res.body.comparables.find((c: { title: string }) => c.title === 'Mal cargada').outlier).toBe(true);
      expect(res.body.estimate.estimatedPriceUsd).toBe(100_000);
    });

    it('con menos de 3 comparables no inventa un valor: lo explica', async () => {
      await create({ coveredM2: 50, priceUsd: 100000, neighborhood: 'Centro' }).expect(201);
      const res = await comps({ type: 'departamento', neighborhood: 'Centro', coveredM2: 50 }).expect(200);
      expect(res.body.estimate).toBeNull();
      expect(res.body.warning).toMatch(/solo 1 propiedad comparable.*al menos 3/);
    });

    it('valida lo mínimo para tasar', async () => {
      await comps({ neighborhood: 'Centro', coveredM2: 50 }).expect(400); // sin tipo
      await comps({ type: 'casa', neighborhood: 'Centro' }).expect(400); // sin superficie
      await comps({ type: 'casa', coveredM2: 50 }).expect(400); // sin ubicación ni barrio
      await comps({ propertyId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    });
  });

  it('cualquier usuario logueado puede cargar propiedades; sin sesión no', async () => {
    const admin = await createUser(app, UserRole.ADMIN);
    await http(app).post('/properties').set(admin.auth).send({ ...base, priceUsd: 1 }).expect(201);
    await http(app).post('/properties').send({ ...base, priceUsd: 1 }).expect(401);
  });
});
