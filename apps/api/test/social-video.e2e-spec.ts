import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { VideoUploadService } from '../src/modules/media/application/video-upload.service';
import { InstagramPublisher, MetaGraphClient } from '../src/modules/social-media/infrastructure/meta.publisher';
import { chunkPlan, TikTokPublisher } from '../src/modules/social-media/infrastructure/tiktok.publisher';
import { FakeGraph } from './fake-graph';
import { createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Un "MP4" mínimo: lo que mira el CRM es la marca "ftyp" en los bytes 4-7. El resto, datos al azar. */
function fakeMp4(bytes: number, brand = 'isom'): Buffer {
  const b = randomBytes(bytes);
  b.write('\x00\x00\x00\x18ftyp' + brand, 0, 'latin1');
  return b;
}

/** TikTok simulado: OAuth, info del creador, inicio de publicación, subida por partes y estado. */
class FakeTikTok {
  calls: { method: string; path: string; body: Record<string, unknown> | string; headers: Record<string, string | string[] | undefined> }[] = [];
  uploads: { range: string; type: string; bytes: Buffer }[] = [];
  initError: string | null = null;
  pendingStatus = 1;
  revoked: string[] = [];
  private server!: Server;
  base = '';

  async start() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const url = new URL(req.url!, 'http://x');
        const path = url.pathname;
        const isForm = String(req.headers['content-type']).includes('form');
        const body = req.method === 'PUT' ? `${raw.length} bytes` : isForm ? Object.fromEntries(new URLSearchParams(raw.toString())) : raw.length ? JSON.parse(raw.toString()) : {};
        this.calls.push({ method: req.method!, path, body, headers: req.headers });
        const json = (status: number, data: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
        const ok = (data: unknown) => json(200, { data, error: { code: 'ok', message: '' } });
        const auth = req.headers.authorization;

        if (path === '/v2/oauth/token/') {
          const f = body as Record<string, string>;
          if (f.client_secret !== 'secreto-tiktok') return json(401, { error: 'invalid_client' });
          if (f.grant_type === 'authorization_code' && f.code !== 'codigo-ok') return json(400, { error: 'invalid_grant', error_description: 'code expired' });
          const n = this.calls.filter((c) => c.path === '/v2/oauth/token/').length;
          return json(200, { access_token: `act-${n}`, expires_in: 86400, refresh_token: 'rft-1', refresh_expires_in: 31536000, open_id: 'open-1', scope: 'user.info.basic,video.publish', token_type: 'Bearer' });
        }
        if (path === '/v2/oauth/revoke/') {
          this.revoked.push((body as Record<string, string>).token);
          return json(200, {});
        }
        // La URL de subida es única por publicación: no lleva token
        if (req.method === 'PUT' && path.startsWith('/upload/')) {
          this.uploads.push({ range: String(req.headers['content-range']), type: String(req.headers['content-type']), bytes: raw });
          return res.writeHead(201).end();
        }
        if (!auth?.startsWith('Bearer act-')) return json(401, { data: {}, error: { code: 'access_token_invalid', message: 'invalid' } });
        if (path === '/v2/user/info/') return ok({ user: { open_id: 'open-1', display_name: 'Inmobiliaria Test', username: 'inmotest' } });
        if (path === '/v2/post/publish/creator_info/query/') {
          return ok({
            creator_nickname: 'Inmobiliaria Test',
            creator_username: 'inmotest',
            privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
            comment_disabled: false,
            duet_disabled: true,
            stitch_disabled: false,
            max_video_post_duration_sec: 600,
          });
        }
        if (path === '/v2/post/publish/video/init/') {
          if (this.initError) return json(403, { data: {}, error: { code: this.initError, message: 'nope' } });
          return ok({ publish_id: 'v_pub_1', upload_url: `${this.base}/upload/v_pub_1` });
        }
        if (path === '/v2/post/publish/status/fetch/') {
          return ok(this.pendingStatus-- > 0 ? { status: 'PROCESSING_UPLOAD' } : { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] });
        }
        json(404, { error: { code: 'not_found', message: path } });
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.base;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  reset() {
    this.calls = [];
    this.uploads = [];
    this.initError = null;
    this.pendingStatus = 1;
    this.revoked = [];
  }
}

describe('Videos, Reels y TikTok', () => {
  let app: NestExpressApplication;
  const graph = new FakeGraph();
  const tiktok = new FakeTikTok();
  let admin: TestUser;
  let agent: TestUser;
  const env: Record<string, string> = {
    META_ACCESS_TOKEN: 'token-pagina',
    META_PAGE_ID: 'page-456',
    META_IG_USER_ID: 'ig-123',
    TIKTOK_CLIENT_KEY: 'clave-tiktok',
    TIKTOK_CLIENT_SECRET: 'secreto-tiktok',
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    // Los videos necesitan un link https (Meta y TikTok los bajan de ahí)
    PUBLIC_URL: 'https://api.crm.test',
    PUBLISH_WAIT_MS: '20000',
  };
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of Object.keys(env)) previous[k] = process.env[k];
    Object.assign(process.env, env, { META_GRAPH_URL: await graph.start(), TIKTOK_API_URL: await tiktok.start() });
    app = await createTestApp();
    Object.assign(app.get(InstagramPublisher) as object, { readyPollMs: 5, videoPollMs: 5 });
    Object.assign(app.get(TikTokPublisher) as object, { statusPollMs: 5 });
  });
  beforeEach(async () => {
    await resetDb(app);
    graph.reset();
    tiktok.reset();
    MetaGraphClient.forgetCache();
    admin = await createUser(app, UserRole.ADMIN);
    agent = await createUser(app);
  });
  afterAll(async () => {
    await app?.close();
    await graph.stop();
    await tiktok.stop();
    for (const k of [...Object.keys(env), 'META_GRAPH_URL', 'TIKTOK_API_URL']) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  });

  const uploadVideo = (data: Buffer, name = 'tour.mp4', type = 'video/mp4') =>
    http(app).post('/media/videos').set(agent.auth).attach('file', data, { filename: name, contentType: type });
  const create = (body: Record<string, unknown>) => http(app).post('/social/posts').set(agent.auth).send(body);
  const publish = (id: string) => http(app).post(`/social/posts/${id}/publish`).set(agent.auth);

  describe('subida de videos', () => {
    it('acepta MP4 y MOV y los publica con link https', async () => {
      const mp4 = await uploadVideo(fakeMp4(2000)).expect(201);
      expect(mp4.body.url).toMatch(/^https:\/\/api\.crm\.test\/uploads\/videos\/[0-9a-f-]{36}\.mp4$/);
      const mov = await uploadVideo(fakeMp4(2000, 'qt  '), 'tour.MOV', 'video/quicktime').expect(201);
      expect(mov.body.url).toMatch(/\.mov$/);
      // Se sirve como archivo estático (Meta lo descarga de ahí), con pedidos por rango
      const path = new URL(mp4.body.url).pathname;
      const res = await http(app).get(path).set('Range', 'bytes=0-9').expect(206);
      expect(res.headers['content-type']).toBe('video/mp4');
    });

    it('rechaza lo que no es un video aunque tenga la extensión', async () => {
      const res = await uploadVideo(Buffer.from('no soy un video, solo texto con nombre de video'), 'falso.mp4').expect(400);
      expect(res.body.message).toMatch(/no es un video MP4 o MOV/);
      await uploadVideo(Buffer.from('hola'), 'nota.txt', 'text/plain').expect(400);
    });

    it('más de 50 MB: 413', async () => {
      await uploadVideo(fakeMp4(50 * 1024 * 1024 + 1)).expect(413);
    });

    it('la limpieza borra los videos que no usa ninguna publicación (con un día de margen)', async () => {
      const used = (await uploadVideo(fakeMp4(1000)).expect(201)).body.url;
      const orphan = (await uploadVideo(fakeMp4(1000)).expect(201)).body.url;
      await create({ platforms: ['facebook'], copy: 'x', mediaUrls: [used] }).expect(201);
      const later = new Date(Date.now() + 2 * 86400_000);
      expect(await app.get(VideoUploadService).cleanup(later)).toBeGreaterThanOrEqual(1); // también cuenta los de otros tests
      await http(app).get(new URL(orphan).pathname).expect(404);
      await http(app).get(new URL(used).pathname).expect(200);
    });
  });

  describe('Reels y videos en Meta', () => {
    it('un video en Instagram sale como Reel; en Facebook, como video', async () => {
      const video = (await uploadVideo(fakeMp4(3000)).expect(201)).body.url;
      const posts = (await create({ platforms: ['instagram', 'facebook'], copy: 'Recorrido', hashtags: ['rosario'], mediaUrls: [video] }).expect(201)).body;
      expect(posts.map((p: { platform: string; format: string }) => [p.platform, p.format]).sort()).toEqual([['facebook', 'video'], ['instagram', 'reel']]);

      graph.pendingPolls = 2;
      for (const p of posts) expect((await publish(p.id).expect(200)).body.status).toBe('publicado');
      const writes = graph.writes();
      expect(writes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'ig-123/media', media_type: 'REELS', video_url: video, caption: 'Recorrido\n\n#rosario', share_to_feed: 'true' }),
          expect.objectContaining({ path: 'page-456/videos', file_url: video, description: 'Recorrido\n\n#rosario' }),
        ]),
      );
      const fb = posts.find((p: { platform: string }) => p.platform === 'facebook');
      expect((await http(app).get(`/social/posts/${fb.id}`).set(agent.auth)).body.externalUrl).toMatch(/^https:\/\/www\.facebook\.com\/reel\/video-/);
    });

    it('un video por publicación, sin mezclar con fotos', async () => {
      const video = (await uploadVideo(fakeMp4(1000)).expect(201)).body.url;
      await create({ platforms: ['facebook'], copy: 'x', mediaUrls: [video, 'https://fotos.test/a.jpg'] }).expect(400);
    });
  });

  describe('TikTok', () => {
    async function connectTikTok() {
      const { body } = await http(app).post('/integrations/tiktok/connect').set(admin.auth).expect(200);
      const auth = new URL(body.url);
      expect(auth.searchParams.get('scope')).toBe('user.info.basic,video.publish');
      expect(auth.searchParams.get('client_key')).toBe('clave-tiktok');
      const res = await http(app).get('/integrations/tiktok/callback').query({ code: 'codigo-ok', state: auth.searchParams.get('state') }).expect(302);
      expect(res.headers.location).toBe('http://localhost:5173/?tiktok=conectado');
    }

    it('conectar: solo un admin; guarda los tokens cifrados; el estado muestra la cuenta', async () => {
      expect((await http(app).get('/social/status').set(agent.auth)).body.tiktok).toBe(false);
      await http(app).post('/integrations/tiktok/connect').set(agent.auth).expect(403);
      await connectTikTok();

      expect((await http(app).get('/integrations/tiktok/status').set(agent.auth)).body).toEqual({ configured: true, connected: true, displayName: 'Inmobiliaria Test', username: 'inmotest' });
      expect((await http(app).get('/social/status').set(agent.auth)).body.tiktok).toBe(true);
      const [row] = await app.get(DataSource).query('SELECT access_token_enc, refresh_token_enc FROM tiktok_accounts');
      expect(row.access_token_enc).not.toContain('act-');
      expect(row.refresh_token_enc).not.toContain('rft-');
    });

    it('un state falso o un código vencido vuelven con error', async () => {
      const bad = await http(app).get('/integrations/tiktok/callback').query({ code: 'codigo-ok', state: 'falso.falso' }).expect(302);
      expect(bad.headers.location).toBe('http://localhost:5173/?tiktok=error');
      const { body } = await http(app).post('/integrations/tiktok/connect').set(admin.auth).expect(200);
      const state = new URL(body.url).searchParams.get('state');
      const expired = await http(app).get('/integrations/tiktok/callback').query({ code: 'codigo-vencido', state }).expect(302);
      expect(expired.headers.location).toBe('http://localhost:5173/?tiktok=error');
      const cancelled = await http(app).get('/integrations/tiktok/callback').query({ error: 'access_denied' }).expect(302);
      expect(cancelled.headers.location).toBe('http://localhost:5173/?tiktok=cancelado');
    });

    it('muestra las opciones del creador que exige TikTok', async () => {
      await connectTikTok();
      const res = await http(app).get('/social/tiktok/creator-info').set(agent.auth).expect(200);
      expect(res.body).toMatchObject({ creatorUsername: 'inmotest', privacyLevelOptions: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'], duetDisabled: true });
    });

    it('valida: hace falta un video subido al CRM y elegir la privacidad', async () => {
      const video = (await uploadVideo(fakeMp4(1000)).expect(201)).body.url;
      await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: ['https://fotos.test/a.jpg'], platformOptions: { privacyLevel: 'SELF_ONLY' } }).expect(400);
      await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: ['https://otro-sitio.test/video.mp4'], platformOptions: { privacyLevel: 'SELF_ONLY' } }).expect(400);
      await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: [video] }).expect(400); // sin privacidad
      await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: [video], platformOptions: { privacyLevel: 'CUALQUIERA' } }).expect(400);
      await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: [video], platformOptions: { privacyLevel: 'SELF_ONLY' } }).expect(201);
    });

    it('publica: sube el video por partes, espera el procesamiento y guarda el link', async () => {
      await connectTikTok();
      const data = fakeMp4(25 * 1024 * 1024 + 123); // 2 partes: 10 MB y el resto (15 MB)
      const video = (await uploadVideo(data).expect(201)).body.url;
      const [post] = (await create({ platforms: ['tiktok'], copy: 'Recorrido por el depto', hashtags: ['rosario'], mediaUrls: [video], platformOptions: { privacyLevel: 'SELF_ONLY', disableDuet: true } }).expect(201)).body;

      const res = await publish(post.id).expect(200);
      expect(res.body).toMatchObject({ status: 'publicado', errorMessage: null, externalUrl: 'https://www.tiktok.com/@inmotest/video/7123' });

      const init = tiktok.calls.find((c) => c.path === '/v2/post/publish/video/init/')!.body as { post_info: Record<string, unknown>; source_info: Record<string, unknown> };
      expect(init.post_info).toEqual({ title: 'Recorrido por el depto\n\n#rosario', privacy_level: 'SELF_ONLY', disable_comment: false, disable_duet: true, disable_stitch: false });
      expect(init.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: data.length, chunk_size: 10 * 1024 * 1024, total_chunk_count: 2 });
      expect(tiktok.uploads.map((u) => u.range)).toEqual([`bytes 0-10485759/${data.length}`, `bytes 10485760-${data.length - 1}/${data.length}`]);
      expect(Buffer.concat(tiktok.uploads.map((u) => u.bytes)).equals(data)).toBe(true);
      expect(tiktok.uploads[0].type).toBe('video/mp4');
    });

    it('cuenta pública sin auditoría: queda fallida con la explicación', async () => {
      await connectTikTok();
      tiktok.initError = 'unaudited_client_can_only_post_to_private_accounts';
      const video = (await uploadVideo(fakeMp4(1000)).expect(201)).body.url;
      const [post] = (await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: [video], platformOptions: { privacyLevel: 'SELF_ONLY' } }).expect(201)).body;
      const res = await publish(post.id).expect(200);
      expect(res.body).toMatchObject({ status: 'fallido', errorMessage: expect.stringMatching(/solo se puede publicar en cuentas privadas/) });
    });

    it('si el token venció, lo renueva solo antes de publicar', async () => {
      await connectTikTok();
      await app.get(DataSource).query(`UPDATE tiktok_accounts SET access_expires_at = now() - interval '1 hour'`);
      const video = (await uploadVideo(fakeMp4(1000)).expect(201)).body.url;
      const [post] = (await create({ platforms: ['tiktok'], copy: 'x', mediaUrls: [video], platformOptions: { privacyLevel: 'SELF_ONLY' } }).expect(201)).body;
      const published = (await publish(post.id).expect(200)).body;
      expect([published.status, published.errorMessage]).toEqual(['publicado', null]);
      const grants = tiktok.calls.filter((c) => c.path === '/v2/oauth/token/').map((c) => (c.body as Record<string, string>).grant_type);
      expect(grants).toEqual(['authorization_code', 'refresh_token']);
    });

    it('desconectar revoca el permiso en TikTok', async () => {
      await connectTikTok();
      await http(app).delete('/integrations/tiktok').set(admin.auth).expect(204);
      expect(tiktok.revoked).toEqual(['act-1']);
      expect((await http(app).get('/integrations/tiktok/status').set(agent.auth)).body.connected).toBe(false);
    });

    it('plan de partes: chico entero; grande en partes de 10 MB con la última más larga', () => {
      expect(chunkPlan(3_000_000)).toEqual({ chunkSize: 3_000_000, total: 1, ranges: [[0, 2_999_999]] });
      const p = chunkPlan(35 * 1024 * 1024);
      expect(p.total).toBe(3);
      expect(p.ranges.at(-1)).toEqual([20 * 1024 * 1024, 35 * 1024 * 1024 - 1]);
    });
  });
});
