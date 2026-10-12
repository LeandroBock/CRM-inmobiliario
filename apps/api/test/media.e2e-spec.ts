import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { ChatHistory, ChatRole } from '../src/modules/communication/domain/chat-history.entity';
import { ChatMediaStorage } from '../src/modules/communication/infrastructure/chat-media.storage';
import { uploadsDir } from '../src/modules/media/infrastructure/local-photo.storage';
import { createLead, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Foto como la de un celular: grande, girada por EXIF y con ubicación GPS. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#4a7' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: 'Celular' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '32/1 57/1 0/1' } })
    .toBuffer();
}

describe('Fotos', () => {
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

  const upload = (...files: { data: Buffer; name: string; type?: string }[]) => {
    const req = http(app).post('/media/photos').set(user.auth);
    for (const f of files) req.attach('files', f.data, { filename: f.name, contentType: f.type ?? 'image/jpeg' });
    return req;
  };
  const fileOf = (url: string) => join(uploadsDir(), 'photos', new URL(url).pathname.split('/').pop()!);

  describe('subida', () => {
    it('achica a 1920 px, respeta la orientación, pasa a JPG y borra el GPS', async () => {
      const res = await upload({ data: await phonePhoto(), name: 'IMG_0001.jpg' }).expect(201);
      const [photo] = res.body;
      expect(photo.url).toMatch(/^http:\/\/localhost:3000\/uploads\/photos\/[0-9a-f-]{36}\.jpg$/);
      // Orientación 6 = girada 90°: queda vertical
      expect(photo).toMatchObject({ width: 1440, height: 1920 });

      const meta = await sharp(fileOf(photo.url)).metadata();
      expect(meta).toMatchObject({ format: 'jpeg', width: 1440, height: 1920 });
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    });

    it('PNG con transparencia: fondo blanco (no negro)', async () => {
      const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      const [photo] = (await upload({ data: png, name: 'logo.png', type: 'image/png' }).expect(201)).body;
      const { data } = await sharp(fileOf(photo.url)).raw().toBuffer({ resolveWithObject: true });
      expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    });

    it('varias fotos devuelven las URLs en el mismo orden', async () => {
      const small = (color: string) => sharp({ create: { width: 30 + color.length, height: 20, channels: 3, background: color } }).jpeg().toBuffer();
      const res = await upload({ data: await small('red'), name: 'a.jpg' }, { data: await small('green'), name: 'b.jpg' }, { data: await small('blue'), name: 'c.jpg' }).expect(201);
      expect(res.body.map((p: { width: number }) => p.width)).toEqual([33, 35, 34]);
    });

    it('si una no es imagen, no se guarda ninguna', async () => {
      const res = await upload({ data: await phonePhoto(), name: 'ok.jpg' }, { data: Buffer.from('%PDF-1.4 hola'), name: 'contrato.jpg' }).expect(400);
      expect(res.body.message).toMatch(/No pude leer "contrato.jpg"/);
    });

    it('rechaza archivos que no dicen ser imágenes', async () => {
      await upload({ data: Buffer.from('hola'), name: 'nota.txt', type: 'text/plain' }).expect(400);
    });

    it('sin archivos: 400; sin sesión: 401', async () => {
      await http(app).post('/media/photos').set(user.auth).expect(400);
      await http(app).post('/media/photos').attach('files', await phonePhoto(), 'x.jpg').expect(401);
    });

    it('las fotos se sirven públicas (portales y redes las bajan sin sesión), con caché larga', async () => {
      const [photo] = (await upload({ data: await phonePhoto(), name: 'a.jpg' }).expect(201)).body;
      const res = await http(app).get(new URL(photo.url).pathname).expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toMatch(/max-age=2592000.*immutable/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('limpieza de fotos huérfanas', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
    const age = (url: string, days: number) => utimes(fileOf(url), daysAgo(days), daysAgo(days));
    const cleanup = (as: TestUser) => http(app).post('/media/photos/cleanup').set(as.auth);

    it('borra las que no usa nadie y tienen más de un día; respeta las usadas y las recién subidas', async () => {
      const admin = await createUser(app, UserRole.ADMIN);
      const [used, orphan, recent] = (await upload(
        { data: await phonePhoto(), name: 'usada.jpg' },
        { data: await phonePhoto(), name: 'huerfana.jpg' },
        { data: await phonePhoto(), name: 'recien.jpg' },
      ).expect(201)).body.map((p: { url: string }) => p.url);
      await age(used, 3);
      await age(orphan, 3);

      // La usada figura en una propiedad (aunque con otro dominio: cuenta la ruta, no el host)
      const usedElsewhere = used.replace('http://localhost:3000', 'https://api.crm.example.com');
      await http(app)
        .post('/properties')
        .set(user.auth)
        .send({ title: 'Casa', type: 'casa', address: 'X 1', neighborhood: 'Centro', city: 'Rosario', province: 'Santa Fe', coveredM2: 1, totalM2: 1, priceUsd: 1, fxRate: 1, photoUrls: [usedElsewhere, 'https://otro-sitio.com/foto.jpg'] })
        .expect(201);

      const res = await cleanup(admin).expect(200);
      expect(res.body.deleted).toBe(1); // en la carpeta quedan también las fotos (recientes) de otros tests
      expect(existsSync(fileOf(used))).toBe(true);
      expect(existsSync(fileOf(orphan))).toBe(false);
      expect(existsSync(fileOf(recent))).toBe(true);
    });

    it('solo un admin la puede correr a mano', async () => {
      await cleanup(user).expect(403);
    });
  });

  describe('adjuntos del chat (audios y fotos de clientes)', () => {
    async function chatWithAudio() {
      const lead = await createLead(app, user);
      const mediaFile = await app.get(ChatMediaStorage).save(Buffer.from('OggS-audio'), 'ogg');
      return app
        .get(DataSource)
        .getRepository(ChatHistory)
        .save({ lead: { id: lead.id }, role: ChatRole.USER, content: 'hola', mediaType: 'audio', mediaFile, mediaMime: 'audio/ogg; codecs=opus' });
    }

    it('se descargan con sesión, sin caché pública y con el tipo correcto', async () => {
      const chat = await chatWithAudio();
      const res = await http(app).get(`/chat-media/${chat.id}`).set(user.auth).expect(200);
      expect(res.headers['content-type']).toBe('audio/ogg');
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
      expect(Buffer.from(res.body).toString()).toBe('OggS-audio');
    });

    it('sin sesión no (son datos personales del cliente)', async () => {
      const chat = await chatWithAudio();
      await http(app).get(`/chat-media/${chat.id}`).expect(401);
    });

    it('no se publican como archivo estático', async () => {
      const chat = await chatWithAudio();
      await http(app).get(`/uploads/chat-media/${chat.mediaFile}`).expect(404);
      await http(app).get(`/uploads/photos/../chat-media/${chat.mediaFile}`).expect(404);
    });

    it('mensaje sin adjunto: 404', async () => {
      const lead = await createLead(app, user);
      const chat = await app.get(DataSource).getRepository(ChatHistory).save({ lead: { id: lead.id }, role: ChatRole.USER, content: 'hola' });
      await http(app).get(`/chat-media/${chat.id}`).set(user.auth).expect(404);
    });
  });
});
