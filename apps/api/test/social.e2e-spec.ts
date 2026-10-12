import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { PublishingService } from '../src/modules/social-media/application/publishing.service';
import { InstagramPublisher, MetaGraphClient } from '../src/modules/social-media/infrastructure/meta.publisher';
import { createProperty, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Graph API de Meta simulada con un servidor HTTP de verdad: se prueba el cliente real (formularios, errores...). */
class FakeGraph {
  calls: { method: string; path: string; params: Record<string, string> }[] = [];
  /** Próximo pedido que tiene que fallar (como Meta: 400 con error.message / error_user_msg). */
  failNext: { path: RegExp; message: string; userMsg?: string } | null = null;
  /** Cuántas consultas de estado responden IN_PROGRESS antes de FINISHED. */
  pendingPolls = 0;
  delayPublishMs = 0;
  private n = 0;
  private server!: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const url = new URL(req.url!, 'http://x');
        const params = Object.fromEntries(new URLSearchParams(req.method === 'POST' ? body : url.search));
        const path = url.pathname.replace(/^\/v25\.0\//, '');
        this.calls.push({ method: req.method!, path, params });
        const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

        // Token del usuario del sistema: solo sirve para pedir el de la página y la cuenta de Instagram
        if (req.method === 'GET' && path === 'page-456' && ['token-sistema', 'token-pagina'].includes(params.access_token)) {
          if (params.fields === 'access_token') return json(200, { access_token: 'token-pagina', id: 'page-456' });
          if (params.fields === 'instagram_business_account' && params.access_token === 'token-pagina') return json(200, { instagram_business_account: { id: 'ig-123' } });
        }
        if (params.access_token !== 'token-pagina') return json(401, { error: { message: '(#200) If posting to a page, requires a Page access token' } });
        if (this.failNext && this.failNext.path.test(path)) {
          const f = this.failNext;
          this.failNext = null;
          return json(400, { error: { message: f.message, error_user_msg: f.userMsg } });
        }
        const id = () => String(++this.n);
        // Instagram
        if (req.method === 'POST' && path === 'ig-123/media') return json(200, { id: `${params.media_type === 'CAROUSEL' ? 'carrusel' : params.is_carousel_item ? 'item' : 'contenedor'}-${id()}` });
        if (req.method === 'POST' && path === 'ig-123/media_publish') {
          await new Promise((r) => setTimeout(r, this.delayPublishMs));
          return json(200, { id: `igpost-${id()}` });
        }
        if (req.method === 'GET' && params.fields === 'status_code,status') {
          return json(200, { status_code: this.pendingPolls-- > 0 ? 'IN_PROGRESS' : 'FINISHED' });
        }
        if (req.method === 'GET' && params.fields === 'permalink') return json(200, { permalink: `https://www.instagram.com/p/${path}/` });
        // Facebook
        if (req.method === 'POST' && path === 'page-456/feed') return json(200, { id: `456_${id()}` });
        if (req.method === 'POST' && path === 'page-456/photos') {
          const photo = `foto-${id()}`;
          return json(200, params.published === 'false' ? { id: photo } : { id: photo, post_id: `456_${id()}` });
        }
        if (req.method === 'GET' && params.fields === 'permalink_url') return json(200, { permalink_url: `https://www.facebook.com/${path}` });
        json(404, { error: { message: `Ruta no simulada: ${req.method} ${path}` } });
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  reset() {
    this.calls = [];
    this.failNext = null;
    this.pendingPolls = 0;
    this.delayPublishMs = 0;
  }

  /** Pedidos de publicación (sin las consultas de estado ni de links). */
  writes(): Record<string, string>[] {
    return this.calls.filter((c) => c.method === 'POST').map(({ path, params: { access_token: _token, ...rest } }) => ({ path, ...rest }));
  }
}

const PHOTO = (n: number) => `https://xyz.supabase.co/storage/v1/object/public/CRM-fotos/photos/foto${n}.jpg`;

describe('Redes sociales (Facebook e Instagram)', () => {
  let app: NestExpressApplication;
  const graph = new FakeGraph();
  let user: TestUser;
  const env = { META_ACCESS_TOKEN: 'token-pagina', META_PAGE_ID: 'page-456', META_IG_USER_ID: 'ig-123' };

  beforeAll(async () => {
    Object.assign(process.env, env, { META_GRAPH_URL: await graph.start() });
    app = await createTestApp();
    // Sin esperar 2 s entre consultas de estado de Instagram
    Object.assign(app.get(InstagramPublisher) as object, { readyPollMs: 10 });
  });
  beforeEach(async () => {
    await resetDb(app);
    graph.reset();
    MetaGraphClient.forgetCache();
    user = await createUser(app);
  });
  afterAll(async () => {
    await app?.close();
    await graph.stop();
    for (const k of [...Object.keys(env), 'META_GRAPH_URL']) delete process.env[k];
  });

  const create = (body: Record<string, unknown>) => http(app).post('/social/posts').set(user.auth).send(body);
  const publish = (id: string) => http(app).post(`/social/posts/${id}/publish`).set(user.auth);

  it('dice qué redes están configuradas', async () => {
    expect((await http(app).get('/social/status').set(user.auth).expect(200)).body).toEqual({ facebook: true, instagram: true });
  });

  describe('crear y editar', () => {
    it('crea una publicación por red con el mismo contenido; limpia los hashtags', async () => {
      const property = await createProperty(app, user, 'Depto Centro');
      const res = await create({
        platforms: ['facebook', 'instagram'],
        copy: '  Hermoso depto en el Centro  ',
        hashtags: ['#Rosario', 'departamento venta', 'rosario'],
        mediaUrls: [PHOTO(1), PHOTO(2)],
        propertyId: property.id,
      }).expect(201);
      expect(res.body).toHaveLength(2);
      for (const p of res.body) {
        expect(p).toMatchObject({ copy: 'Hermoso depto en el Centro', hashtags: ['Rosario', 'departamento', 'venta'], format: 'carrusel', status: 'borrador', property: { id: property.id } });
      }
      const list = await http(app).get('/social/posts').set(user.auth).expect(200);
      expect(list.body.total).toBe(2);
    });

    it('valida las reglas de cada red al guardar', async () => {
      await create({ platforms: ['instagram'], copy: 'Sin foto' }).expect(400); // Instagram necesita foto
      await create({ platforms: ['facebook'], copy: '' }).expect(400); // vacía
      await create({ platforms: ['facebook'], copy: 'x', mediaUrls: Array.from({ length: 11 }, (_, i) => PHOTO(i)) }).expect(400);
      await create({ platforms: ['facebook'], copy: 'x', mediaUrls: ['http://inseguro.com/a.jpg'] }).expect(400);
      await create({ platforms: ['instagram'], copy: 'x'.repeat(2201), mediaUrls: [PHOTO(1)] }).expect(400);
      await create({ platforms: ['tiktok'], copy: 'x' }).expect(400); // todavía no
      await create({ platforms: [], copy: 'x' }).expect(400);
      await create({ platforms: ['facebook'], copy: 'Solo texto en Facebook' }).expect(201);
    });

    it('programar exige una fecha futura; null la saca y vuelve a borrador', async () => {
      const [post] = (await create({ platforms: ['facebook'], copy: 'Hola' }).expect(201)).body;
      await http(app).patch(`/social/posts/${post.id}`).set(user.auth).send({ scheduledAt: '2020-01-01T10:00:00-03:00' }).expect(400);
      const inOneHour = new Date(Date.now() + 3600_000).toISOString();
      const scheduled = await http(app).patch(`/social/posts/${post.id}`).set(user.auth).send({ scheduledAt: inOneHour }).expect(200);
      expect(scheduled.body).toMatchObject({ status: 'programado' });
      const back = await http(app).patch(`/social/posts/${post.id}`).set(user.auth).send({ scheduledAt: null }).expect(200);
      expect(back.body).toMatchObject({ status: 'borrador', scheduledAt: null });
    });
  });

  describe('publicar', () => {
    it('Instagram, carrusel: un contenedor por foto, el carrusel y la publicación; guarda el link', async () => {
      graph.pendingPolls = 2; // Instagram tarda un poco en procesar
      const [post] = (await create({ platforms: ['instagram'], copy: 'Depto con vista', hashtags: ['rosario'], mediaUrls: [PHOTO(1), PHOTO(2)] }).expect(201)).body;
      const res = await publish(post.id).expect(200);

      expect(res.body).toMatchObject({ status: 'publicado', externalUrl: expect.stringMatching(/^https:\/\/www\.instagram\.com\/p\/igpost-/) });
      const writes = graph.writes();
      expect(writes).toEqual([
        expect.objectContaining({ path: 'ig-123/media', image_url: PHOTO(1), is_carousel_item: 'true' }),
        expect.objectContaining({ path: 'ig-123/media', image_url: PHOTO(2), is_carousel_item: 'true' }),
        expect.objectContaining({ path: 'ig-123/media', media_type: 'CAROUSEL', caption: 'Depto con vista\n\n#rosario' }),
        expect.objectContaining({ path: 'ig-123/media_publish' }),
      ]);
      expect(writes[2].children).toMatch(/^item-\d+,item-\d+$/);
    });

    it('Facebook, varias fotos: se suben sin publicar y salen en un solo posteo', async () => {
      const [post] = (await create({ platforms: ['facebook'], copy: 'Casa en Funes', mediaUrls: [PHOTO(1), PHOTO(2)] }).expect(201)).body;
      const res = await publish(post.id).expect(200);
      expect(res.body.status).toBe('publicado');
      const writes = graph.writes();
      expect(writes.slice(0, 2)).toEqual([
        expect.objectContaining({ path: 'page-456/photos', url: PHOTO(1), published: 'false' }),
        expect.objectContaining({ path: 'page-456/photos', url: PHOTO(2), published: 'false' }),
      ]);
      expect(writes[2]).toMatchObject({ path: 'page-456/feed', message: 'Casa en Funes' });
      expect(JSON.parse(writes[2]['attached_media[0]'])).toEqual({ media_fbid: expect.stringMatching(/^foto-/) });
      expect(res.body.externalUrl).toMatch(/^https:\/\/www\.facebook\.com\/456_/);
    });

    it('si Meta rechaza, queda "fallido" con el motivo; al corregir vuelve a borrador y se puede reintentar', async () => {
      const [post] = (await create({ platforms: ['instagram'], copy: 'x', mediaUrls: [PHOTO(1)] }).expect(201)).body;
      graph.failNext = { path: /media$/, message: '(#9004) The media could not be fetched', userMsg: 'La foto no se pudo descargar.' };
      const failed = await publish(post.id).expect(200);
      expect(failed.body).toMatchObject({ status: 'fallido', errorMessage: 'La foto no se pudo descargar.' });

      const fixed = await http(app).patch(`/social/posts/${post.id}`).set(user.auth).send({ mediaUrls: [PHOTO(3)] }).expect(200);
      expect(fixed.body).toMatchObject({ status: 'borrador', errorMessage: null });
      expect((await publish(post.id).expect(200)).body.status).toBe('publicado');
    });

    it('dos clics seguidos publican una sola vez', async () => {
      graph.delayPublishMs = 300;
      const [post] = (await create({ platforms: ['instagram'], copy: 'x', mediaUrls: [PHOTO(1)] }).expect(201)).body;
      const [a, b] = await Promise.all([publish(post.id), publish(post.id)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(graph.writes().filter((w) => w.path === 'ig-123/media_publish')).toHaveLength(1);
    });

    it('una vez publicada no se edita; borrarla la saca solo del CRM', async () => {
      const [post] = (await create({ platforms: ['facebook'], copy: 'x' }).expect(201)).body;
      await publish(post.id).expect(200);
      await http(app).patch(`/social/posts/${post.id}`).set(user.auth).send({ copy: 'otro' }).expect(409);
      await publish(post.id).expect(409);
      await http(app).delete(`/social/posts/${post.id}`).set(user.auth).expect(204);
    });
  });

  describe('programadas', () => {
    it('el programador publica las que ya llegaron a su hora, y no las futuras', async () => {
      const inOneHour = new Date(Date.now() + 3600_000).toISOString();
      const [due] = (await create({ platforms: ['facebook'], copy: 'Ya', scheduledAt: inOneHour }).expect(201)).body;
      const [later] = (await create({ platforms: ['facebook'], copy: 'Después', scheduledAt: inOneHour }).expect(201)).body;
      await app.get(DataSource).query(`UPDATE social_posts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [due.id]);

      await app.get(PublishingService).publishDue();
      expect((await http(app).get(`/social/posts/${due.id}`).set(user.auth)).body.status).toBe('publicado');
      expect((await http(app).get(`/social/posts/${later.id}`).set(user.auth)).body.status).toBe('programado');
    });

    it('si la API se cortó en medio de una publicación, a los 10 minutos queda fallida (sin reintentar sola)', async () => {
      const [post] = (await create({ platforms: ['facebook'], copy: 'x' }).expect(201)).body;
      await app.get(DataSource).query(`UPDATE social_posts SET status = 'publicando', updated_at = now() - interval '11 minutes' WHERE id = $1`, [post.id]);
      await app.get(PublishingService).publishDue();
      const res = await http(app).get(`/social/posts/${post.id}`).set(user.auth);
      expect(res.body).toMatchObject({ status: 'fallido', errorMessage: expect.stringMatching(/Fijate en la red si salió/) });
      expect(graph.writes()).toEqual([]);
    });
  });

  it('con el token permanente de Meta Business: pide el de la página y encuentra sola la cuenta de Instagram', async () => {
    process.env.META_ACCESS_TOKEN = 'token-sistema';
    delete process.env.META_IG_USER_ID;
    try {
      expect((await http(app).get('/social/status').set(user.auth)).body).toEqual({ facebook: true, instagram: true });
      const posts = (await create({ platforms: ['facebook', 'instagram'], copy: 'Hola', mediaUrls: [PHOTO(1)] }).expect(201)).body;
      for (const p of posts) expect((await publish(p.id).expect(200)).body.status).toBe('publicado');
      // Todo lo que publicó usó el token de la página (el del sistema solo para pedirlo)
      const writes = graph.calls.filter((c) => c.method === 'POST');
      expect(writes.every((c) => c.params.access_token === 'token-pagina')).toBe(true);
      expect(writes.some((c) => c.path === 'ig-123/media')).toBe(true);
    } finally {
      process.env.META_ACCESS_TOKEN = env.META_ACCESS_TOKEN;
      process.env.META_IG_USER_ID = env.META_IG_USER_ID;
    }
  });

  it('sin las claves de Meta: la pantalla lo sabe y publicar falla con un motivo claro', async () => {
    const [post] = (await create({ platforms: ['facebook'], copy: 'x' }).expect(201)).body;
    delete process.env.META_ACCESS_TOKEN;
    try {
      expect((await http(app).get('/social/status').set(user.auth)).body).toEqual({ facebook: false, instagram: false });
      const res = await publish(post.id).expect(200);
      expect(res.body).toMatchObject({ status: 'fallido', errorMessage: expect.stringMatching(/Falta configurar facebook/) });
    } finally {
      process.env.META_ACCESS_TOKEN = env.META_ACCESS_TOKEN;
    }
  });
});
