import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { outputSize } from '../src/modules/media/application/photo-ai.service';
import { uploadsDir } from '../src/modules/media/infrastructure/local-photo.storage';
import { createTestApp, createUser, http, resetDb, TestUser } from './helpers';

interface CfCall {
  path: string;
  auth: string | undefined;
  prompt: string;
  width: number;
  height: number;
  input: { width: number; height: number };
}

/** Workers AI de Cloudflare simulado: recibe el formulario de verdad y devuelve una imagen del tamaño pedido. */
class FakeCloudflare {
  calls: CfCall[] = [];
  /** Próxima respuesta con error: [status, cuerpo]. */
  failNext: [number, unknown] | null = null;
  /** Devolver la imagen directo (bytes) en vez de JSON con base64. */
  rawImage = false;
  private server!: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const form = await new Request('http://x', { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }).formData();
        const file = form.get('input_image_0') as File;
        const input = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
        const call: CfCall = {
          path: req.url!,
          auth: req.headers.authorization,
          prompt: String(form.get('prompt')),
          width: Number(form.get('width')),
          height: Number(form.get('height')),
          input: { width: input.width!, height: input.height! },
        };
        this.calls.push(call);
        if (this.failNext) {
          const [status, body] = this.failNext;
          this.failNext = null;
          return res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        }
        const png = await sharp({ create: { width: call.width, height: call.height, channels: 3, background: '#c96' } }).png().toBuffer();
        if (this.rawImage) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, result: { image: png.toString('base64') } }));
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/client/v4`;
  }
  stop() {
    return new Promise((r) => this.server.close(r));
  }
  reset() {
    this.calls = [];
    this.failNext = null;
    this.rawImage = false;
  }
}

describe('Fotos con IA (Cloudflare)', () => {
  let app: NestExpressApplication;
  const cf = new FakeCloudflare();
  let user: TestUser;
  const env = { CLOUDFLARE_ACCOUNT_ID: 'cuenta-123', CLOUDFLARE_AI_TOKEN: ' token-cf ' };

  beforeAll(async () => {
    Object.assign(process.env, env, { CLOUDFLARE_API_URL: await cf.start() });
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    cf.reset();
    user = await createUser(app);
  });
  afterAll(async () => {
    await app?.close();
    await cf.stop();
    for (const k of [...Object.keys(env), 'CLOUDFLARE_API_URL']) delete process.env[k];
  });

  async function uploadPhoto(width = 1920, height = 1440): Promise<string> {
    const jpg = await sharp({ create: { width, height, channels: 3, background: '#eee' } }).jpeg().toBuffer();
    const res = await http(app).post('/media/photos').set(user.auth).attach('files', jpg, { filename: 'living.jpg', contentType: 'image/jpeg' }).expect(201);
    return res.body[0].url;
  }
  const edit = (body: Record<string, unknown>) => http(app).post('/media/photos/ai').set(user.auth).send(body);
  const fileOf = (url: string) => join(uploadsDir(), 'photos', new URL(url).pathname.split('/').pop()!);

  it('dice si está configurada', async () => {
    expect((await http(app).get('/media/photos/ai').set(user.auth).expect(200)).body).toEqual({ configured: true });
  });

  it('amuebla: manda la foto chica y el pedido, guarda una foto NUEVA con la leyenda y deja la original igual', async () => {
    const url = await uploadPhoto();
    const before = await readFile(fileOf(url));

    const res = await edit({ url, action: 'amueblar', instructions: 'estilo nórdico' }).expect(201);

    expect(res.body.url).not.toBe(url);
    expect(res.body).toMatchObject({ width: 1536, height: 1152 });
    const out = await sharp(await readFile(fileOf(res.body.url))).metadata();
    expect([out.width, out.height, out.format]).toEqual([1536, 1152, 'jpeg']);
    expect(await readFile(fileOf(url))).toEqual(before); // la original no cambió

    const call = cf.calls[0];
    expect(call.path).toBe('/client/v4/accounts/cuenta-123/ai/run/@cf/black-forest-labs/flux-2-klein-4b');
    expect(call.auth).toBe('Bearer token-cf'); // sin los espacios
    expect(Math.max(call.input.width, call.input.height)).toBeLessThanOrEqual(512);
    expect(call.prompt).toMatch(/Virtual staging/);
    expect(call.prompt).toMatch(/same room/);
    expect(call.prompt).toContain('estilo nórdico');
    expect([call.width % 16, call.height % 16]).toEqual([0, 0]);
  });

  it('acepta la imagen como bytes y respeta fotos verticales', async () => {
    cf.rawImage = true;
    const url = await uploadPhoto(1080, 1920);
    const res = await edit({ url, action: 'mejorar' }).expect(201);
    expect(res.body).toMatchObject({ width: 864, height: 1536 });
    expect(cf.calls[0].prompt).toMatch(/Do not add, remove or move/);
  });

  it('valida: solo fotos del CRM, acción conocida, instrucciones en "personalizado"', async () => {
    const url = await uploadPhoto();
    await edit({ url: 'https://otro-sitio.com/foto.jpg', action: 'mejorar' }).expect(400);
    await edit({ url, action: 'pintar' }).expect(400);
    const res = await edit({ url, action: 'personalizado' }).expect(400);
    expect(res.body.message).toMatch(/qué querés cambiar/);
    await edit({ url: 'http://localhost:3000/uploads/photos/00000000-0000-4000-8000-000000000000.jpg', action: 'mejorar' }).expect(404);
    expect(cf.calls).toHaveLength(0);
  });

  it('cupo diario agotado y clave rechazada: avisa qué pasó', async () => {
    const url = await uploadPhoto();
    cf.failNext = [429, { success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] }];
    expect((await edit({ url, action: 'ordenar' }).expect(503)).body.message).toMatch(/cupo gratis de hoy/);
    cf.failNext = [403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }];
    expect((await edit({ url, action: 'ordenar' }).expect(503)).body.message).toMatch(/CLOUDFLARE_AI_TOKEN/);
  });

  it('sin claves de Cloudflare: 503 con lo que falta', async () => {
    const url = await uploadPhoto();
    delete process.env.CLOUDFLARE_AI_TOKEN;
    const other = await createTestApp();
    try {
      const u = await createUser(other);
      expect((await http(other).get('/media/photos/ai').set(u.auth).expect(200)).body).toEqual({ configured: false });
      const res = await http(other).post('/media/photos/ai').set(u.auth).send({ url, action: 'mejorar' }).expect(503);
      expect(res.body.message).toMatch(/CLOUDFLARE_AI_TOKEN/);
    } finally {
      await other.close();
      process.env.CLOUDFLARE_AI_TOKEN = env.CLOUDFLARE_AI_TOKEN;
    }
  });

  it('tamaño de salida', () => {
    expect(outputSize(4000, 3000)).toEqual({ width: 1536, height: 1152 });
    expect(outputSize(3000, 4000)).toEqual({ width: 1152, height: 1536 });
    expect(outputSize(5000, 500)).toEqual({ width: 1536, height: 256 });
  });
});
