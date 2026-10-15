import { NestExpressApplication } from '@nestjs/platform-express';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { latin } from '../src/modules/properties/application/property-sheet.service';
import { createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Cuántas hojas tiene el PDF. */
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

const binary = (res: import('superagent').Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Ficha PDF de la propiedad', () => {
  let app: NestExpressApplication;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    user = await createUser(app);
  });
  afterAll(() => app?.close());

  async function photos(n: number): Promise<string[]> {
    const req = http(app).post('/media/photos').set(user.auth);
    const colors = ['#c96', '#69c', '#9c6', '#c69', '#6c9', '#96c', '#cc6'];
    for (let i = 0; i < n; i++) {
      const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: colors[i % colors.length] } }).jpeg().toBuffer();
      req.attach('files', jpg, { filename: `f${i}.jpg`, contentType: 'image/jpeg' });
    }
    return (await req.expect(201)).body.map((p: { url: string }) => p.url);
  }

  async function property(photoUrls: string[]) {
    const res = await http(app)
      .post('/properties')
      .set(user.auth)
      .send({
        title: 'Depto luminoso con balcón 🌞',
        description: 'Hermoso departamento a estrenar, con balcón al frente y mucha luz natural. Cocina integrada, lavadero independiente.',
        type: 'departamento',
        operation: 'venta',
        address: 'Córdoba 1234',
        neighborhood: 'Centro',
        city: 'Rosario',
        province: 'Santa Fe',
        coveredM2: 62,
        totalM2: 68.5,
        rooms: 3,
        bedrooms: 2,
        bathrooms: 1,
        garageSpots: 1,
        ageYears: 0,
        amenities: ['pileta', 'SUM', 'parrilla'],
        priceUsd: 125000,
        fxRate: 1200,
        photoUrls,
      })
      .expect(201);
    return res.body;
  }

  const sheet = (id: string, body: Record<string, unknown> = {}) => http(app).post(`/properties/${id}/sheet`).set(user.auth).send(body).buffer(true).parse(binary);

  it('arma un PDF de 2 hojas con portada y más fotos', async () => {
    const urls = await photos(5);
    const p = await property(urls);
    const res = await sheet(p.id, { agencyName: 'Inmobiliaria Ejemplo', contact: 'WhatsApp 341 555-0000', brandColor: '#0a7c5a', logoUrl: urls[4], showArs: true }).expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="ficha-depto-luminoso-con-balcon.pdf"');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(2);
    expect(pdf.length).toBeLessThan(3_000_000);
    if (process.env.SAVE_SHEET) writeFileSync(process.env.SAVE_SHEET, pdf);
  });

  it('una sola foto: una sola hoja; sin fotos también sale', async () => {
    const [one] = await photos(1);
    expect(pages((await sheet((await property([one])).id).expect(200)).body)).toBe(1);
    expect(pages((await sheet((await property([])).id).expect(200)).body)).toBe(1);
  });

  it('elige fotos: solo las del CRM; valida opciones', async () => {
    const urls = await photos(3);
    const p = await property(urls);
    expect(pages((await sheet(p.id, { photoUrls: [urls[2], 'https://otro-sitio.com/x.jpg', urls[0]] }).expect(200)).body)).toBe(2);
    await sheet(p.id, { photoUrls: ['https://otro-sitio.com/x.jpg'] }).expect(400);
    await sheet(p.id, { brandColor: 'rojo' }).expect(400);
    await sheet(p.id, { photoUrls: Array(8).fill(urls[0]) }).expect(400);
    await sheet('00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('saca emojis y símbolos que la fuente del PDF no tiene', () => {
    expect(latin('Depto 🌞 “luminoso” — 2 amb. · 60 m² ñ')).toBe('Depto "luminoso" - 2 amb. · 60 m² ñ');
  });
});
