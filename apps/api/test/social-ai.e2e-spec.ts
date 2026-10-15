import { NestExpressApplication } from '@nestjs/platform-express';
import { ContentLlm, JsonSchema } from '../src/modules/social-media/infrastructure/content-llm';
import { createProperty, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

/** Claude simulado para los textos: devuelve lo encolado y guarda el prompt. */
class FakeContentLlm {
  configured = true;
  calls: { system: string; prompt: string; schema: JsonSchema }[] = [];
  private queue: unknown[] = [];

  isConfigured() {
    return this.configured;
  }
  willReturn(...outs: unknown[]) {
    this.queue.push(...outs);
  }
  async json<T>(system: string, prompt: string, schema: JsonSchema): Promise<T> {
    this.calls.push({ system, prompt, schema });
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return next as T;
  }
  reset() {
    this.configured = true;
    this.calls = [];
    this.queue = [];
  }
}

describe('Textos con IA (publicaciones y reels)', () => {
  let app: NestExpressApplication;
  const llm = new FakeContentLlm();
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp([[ContentLlm, llm]]);
  });
  beforeEach(async () => {
    await resetDb(app);
    llm.reset();
    user = await createUser(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  const aiPost = (body: Record<string, unknown>) => http(app).post('/social/ai/post').set(user.auth).send(body);
  const aiReel = (body: Record<string, unknown>) => http(app).post('/social/ai/reel').set(user.auth).send(body);

  it('dice si la IA está configurada', async () => {
    expect((await http(app).get('/social/ai').set(user.auth).expect(200)).body).toEqual({ configured: true });
    llm.configured = false;
    expect((await http(app).get('/social/ai').set(user.auth).expect(200)).body).toEqual({ configured: false });
  });

  it('escribe un texto nuevo con los datos de la propiedad y limpia los hashtags', async () => {
    const property = await createProperty(app, user, 'Depto luminoso Centro');
    llm.willReturn({ copy: '  🏡 Depto luminoso en el Centro\nEscribinos  ', hashtags: ['#Rosario', 'Villa Gálvez', 'rosario', 'Venta'] });

    const res = await aiPost({ propertyId: property.id, platforms: ['facebook', 'instagram'], tone: 'profesional' }).expect(200);

    expect(res.body).toEqual({ copy: '🏡 Depto luminoso en el Centro\nEscribinos', hashtags: ['Rosario', 'VillaGalvez', 'Venta'] });
    const { system, prompt, schema } = llm.calls[0];
    expect(system).toContain('rioplatense');
    expect(prompt).toContain('Depto luminoso Centro');
    expect(prompt).toContain('USD');
    expect(prompt).toContain('profesional');
    expect(prompt).not.toContain('TEXTO ACTUAL');
    expect(schema).toMatchObject({ required: ['copy', 'hashtags'], additionalProperties: false });
  });

  it('reescribe el texto actual con las indicaciones del asesor', async () => {
    llm.willReturn({ copy: 'Más corto', hashtags: ['Rosario'] });
    await aiPost({
      platforms: ['instagram'],
      instructions: 'Hacelo más corto',
      current: { copy: 'Un texto largo que hay que acortar', hashtags: ['Rosario'] },
    }).expect(200);
    expect(llm.calls[0].prompt).toContain('TEXTO ACTUAL');
    expect(llm.calls[0].prompt).toContain('Un texto largo que hay que acortar');
    expect(llm.calls[0].prompt).toContain('Hacelo más corto');
  });

  it('pide algo de qué escribir y valida los datos', async () => {
    const res = await aiPost({ platforms: ['facebook'] }).expect(400);
    expect(res.body.message).toMatch(/Elegí una propiedad/);
    await aiPost({ platforms: [], instructions: 'x' }).expect(400);
    await aiPost({ platforms: ['facebook'], instructions: 'x', tone: 'gritón' }).expect(400);
    await aiPost({ platforms: ['facebook'], propertyId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    expect(llm.calls).toHaveLength(0);
  });

  it('sin ANTHROPIC_API_KEY responde 503 con el motivo', async () => {
    // El cliente real (sin el doble) avisa qué falta
    const real = await createTestApp();
    try {
      const u = await createUser(real);
      const res = await http(real).post('/social/ai/post').set(u.auth).send({ platforms: ['facebook'], instructions: 'algo' }).expect(503);
      expect(res.body.message).toMatch(/ANTHROPIC_API_KEY/);
      expect((await http(real).get('/social/ai').set(u.auth).expect(200)).body).toEqual({ configured: false });
    } finally {
      await real.close();
    }
  });

  it('textos del reel: uno por foto, cortos', async () => {
    const property = await createProperty(app, user);
    llm.willReturn({ kicker: 'oportunidad', title: 'Tu primer depto en el Centro', captions: ['📍 Centro, Rosario', '2 ambientes', 'x'.repeat(100), 'sobra'] });

    const res = await aiReel({ propertyId: property.id, photoCount: 3, instructions: 'Destacá la luz' }).expect(200);

    expect(res.body.kicker).toBe('OPORTUNIDAD');
    expect(res.body.title).toBe('Tu primer depto en el Centro');
    expect(res.body.captions).toHaveLength(3);
    expect(res.body.captions[2]).toHaveLength(60);
    expect(llm.calls[0].prompt).toContain('exactamente 3');
    expect(llm.calls[0].prompt).toContain('Destacá la luz');

    llm.willReturn({ kicker: 'EN VENTA', title: 'T', captions: ['uno'] });
    const pocos = await aiReel({ propertyId: property.id, photoCount: 2 }).expect(200);
    expect(pocos.body.captions).toEqual(['uno', '']); // si devuelve menos, completa vacío

    await aiReel({ propertyId: property.id, photoCount: 11 }).expect(400);
  });
});
