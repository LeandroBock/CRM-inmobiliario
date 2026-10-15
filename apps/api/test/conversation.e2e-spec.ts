import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/modules/auth/domain/user-role.enum';
import { ConversationService, IncomingMessage } from '../src/modules/communication/application/conversation.service';
import { ChatHistory } from '../src/modules/communication/domain/chat-history.entity';
import { AudioTranscriber } from '../src/modules/communication/infrastructure/audio-transcriber';
import { ChatMediaStorage } from '../src/modules/communication/infrastructure/chat-media.storage';
import { LlmClient } from '../src/modules/communication/infrastructure/llm.client';
import { WhatsAppClient } from '../src/modules/communication/infrastructure/whatsapp.client';
import { Lead } from '../src/modules/leads/domain/lead.entity';
import { Visit } from '../src/modules/visits/domain/visit.entity';
import { FakeLlm, FakeTranscriber, FakeWhatsApp } from './fakes';
import { createProperty, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

const CLIENT = '5493415550001'; // como lo manda Meta: sin "+"

describe('Asistente de WhatsApp', () => {
  let app: NestExpressApplication;
  const llm = new FakeLlm();
  const whatsapp = new FakeWhatsApp();
  const transcriber = new FakeTranscriber();
  let agent: TestUser;
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp([
      [LlmClient, llm],
      [WhatsAppClient, whatsapp],
      [AudioTranscriber, transcriber],
    ]);
  });
  beforeEach(async () => {
    await resetDb(app);
    llm.reset();
    whatsapp.reset();
    transcriber.result = null;
    agent = await createUser(app, UserRole.AGENT, { fullName: 'Ana' });
  });
  afterAll(async () => {
    await resetDb(app); // que no queden conversaciones "sin responder" para la próxima app que arranque
    await app?.close();
  });

  const db = () => app.get(DataSource);
  const conversation = () => app.get(ConversationService);
  const text = (body: string, from = CLIENT, name?: string): IncomingMessage => ({ wamid: `wamid.in.${++seq}`, from, name, kind: 'text', text: body });
  /** Recibe el mensaje y espera a que salga la respuesta (que se manda después de una espera). */
  const receive = async (m: IncomingMessage) => {
    await conversation().handleIncoming(m);
    await conversation().whenIdle();
  };
  /** Espera configurable antes de contestar; vuelve a 0 al terminar el test. */
  const withReplyDelay = (ms: number) => {
    process.env.WHATSAPP_REPLY_DELAY_MS = String(ms);
  };
  afterEach(() => {
    process.env.WHATSAPP_REPLY_DELAY_MS = '0';
  });
  const leadByPhone = (phone = `+${CLIENT}`) =>
    db().getRepository(Lead).findOne({ where: { phone }, relations: { assignedTo: true } });
  const chatOf = async (leadId: string) =>
    db().getRepository(ChatHistory).find({ where: { lead: { id: leadId } }, order: { createdAt: 'ASC' } });
  const notificationsOf = async (user: TestUser) => (await http(app).get('/notifications').set(user.auth).expect(200)).body;

  describe('mensaje de un número nuevo', () => {
    it('crea el lead, se lo asigna a un asesor, responde con lo que dice Claude y marca el mensaje como leído', async () => {
      llm.willReply({ text: '¡Hola Juan! ¿Qué estás buscando?' });
      const m = text('Hola, busco depto', CLIENT, 'Juan Pérez');
      await receive(m);

      const lead = await leadByPhone();
      expect(lead).toMatchObject({ fullName: 'Juan Pérez', assignedTo: { id: agent.id } });
      expect(whatsapp.sent).toEqual([{ to: CLIENT, text: '¡Hola Juan! ¿Qué estás buscando?' }]);
      expect(whatsapp.read).toEqual([m.wamid]);

      const chat = await chatOf(lead!.id);
      expect(chat.map((c) => [c.role, c.content])).toEqual([
        ['user', 'Hola, busco depto'],
        ['assistant', '¡Hola Juan! ¿Qué estás buscando?'],
      ]);
      expect(lead!.lastInteractionAt).toBeTruthy();
    });

    it('si Meta reenvía el mismo mensaje, no se procesa dos veces', async () => {
      const m = text('Hola');
      await receive(m);
      await receive(m);
      expect(llm.calls).toHaveLength(1);
      expect(whatsapp.sent).toHaveLength(1);
    });

    it('si Meta reenvía el mensaje mientras se procesa el primero, se contesta una sola vez', async () => {
      const repo = db().getRepository(ChatHistory);
      const exist = repo.exist.bind(repo);
      const spy = jest.spyOn(repo, 'exist').mockImplementation(async (opts) => {
        const found = await exist(opts);
        await new Promise((r) => setTimeout(r, 100));
        return found;
      });
      try {
        const m = text('Hola');
        await Promise.all([receive(m), receive(m), receive(m)]);
      } finally {
        spy.mockRestore();
      }
      expect(llm.calls).toHaveLength(1);
      expect(whatsapp.sent).toHaveLength(1);
    });

    it('varios mensajes casi juntos de un número nuevo crean un solo lead y se guardan todos', async () => {
      // La base local responde tan rápido que la carrera casi nunca se da sola: se demora la búsqueda del lead
      // para que todos los mensajes vean "no existe" antes de que alguno lo cree (como con la base en otra máquina).
      const repo = db().getRepository(Lead);
      const findOne = repo.findOne.bind(repo);
      const spy = jest.spyOn(repo, 'findOne').mockImplementation(async (opts) => {
        const found = await findOne(opts);
        await new Promise((r) => setTimeout(r, 100));
        return found;
      });
      withReplyDelay(300);
      try {
        await Promise.all(['Hola', '¿Están?', 'Busco depto', 'En Centro', 'Gracias'].map((t) => receive(text(t))));
      } finally {
        spy.mockRestore();
      }
      expect(whatsapp.sent).toHaveLength(1);
      const leads = await db().getRepository(Lead).find();
      expect(leads).toHaveLength(1);
      const userMessages = (await chatOf(leads[0].id)).filter((c) => c.role === 'user').map((c) => c.content);
      expect(userMessages.sort()).toEqual(['Busco depto', 'En Centro', 'Gracias', 'Hola', '¿Están?']);
    });
  });

  describe('sin asistente (sin clave de Claude)', () => {
    beforeEach(() => {
      llm.configured = false;
    });

    it('no le manda nada al cliente: el mensaje queda en el CRM y le avisa al asesor', async () => {
      await receive(text('Hola, ¿siguen alquilando el depto de Córdoba?', CLIENT, 'Juan'));
      await receive(text('Es para mudarme en marzo'));

      expect(llm.calls).toHaveLength(0);
      expect(whatsapp.sent).toEqual([]);
      const lead = (await leadByPhone())!;
      expect((await chatOf(lead.id)).map((c) => c.role)).toEqual(['user', 'user']);

      const waiting = (await notificationsOf(agent)).filter((n: { type: string }) => n.type === 'cliente_esperando');
      expect(waiting).toEqual([expect.objectContaining({ title: 'Juan te escribió', body: 'Es para mudarme en marzo', leadId: lead.id })]);
    });

    it('tampoco manda las respuestas fijas (stickers, audios): las ve el asesor', async () => {
      await receive({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'unsupported', type: 'sticker' });
      expect(whatsapp.sent).toEqual([]);
      const waiting = (await notificationsOf(agent)).filter((n: { type: string }) => n.type === 'cliente_esperando');
      expect(waiting[0].body).toBe('[El cliente mandó un sticker]');
    });

    it('el asesor contesta desde el CRM normalmente', async () => {
      await receive(text('Hola'));
      const lead = (await leadByPhone())!;
      await http(app).post(`/leads/${lead.id}/messages`).set(agent.auth).send({ text: 'Hola, soy Ana' }).expect(201);
      expect(whatsapp.sent).toEqual([{ to: CLIENT, text: 'Hola, soy Ana' }]);
    });

    it('al cargar la clave, el asistente vuelve a contestar solo', async () => {
      await receive(text('Hola'));
      expect(whatsapp.sent).toEqual([]);
      llm.configured = true;
      llm.willReply({ text: '¡Hola! ¿Qué estás buscando?' });
      await receive(text('Busco depto'));
      expect(whatsapp.sent).toEqual([{ to: CLIENT, text: '¡Hola! ¿Qué estás buscando?' }]);
      // Claude ve los dos mensajes juntos (los que nadie había contestado)
      expect(llm.calls[0].history).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hola' }, { type: 'text', text: 'Busco depto' }] }]);
    });
  });

  describe('mensajes seguidos', () => {
    const sendNow = (m: IncomingMessage) => conversation().handleIncoming(m); // sin esperar la respuesta

    it('varios mensajes seguidos reciben una sola respuesta, con todo lo que escribió', async () => {
      withReplyDelay(300);
      llm.willReply({ text: 'Tengo dos opciones en Centro.' });
      await sendNow(text('Hola'));
      await sendNow(text('busco depto'));
      await sendNow(text('en Centro, hasta 100 mil'));
      await conversation().whenIdle();

      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0].history).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hola' },
            { type: 'text', text: 'busco depto' },
            { type: 'text', text: 'en Centro, hasta 100 mil' },
          ],
        },
      ]);
      expect(whatsapp.sent).toEqual([{ to: CLIENT, text: 'Tengo dos opciones en Centro.' }]);
    });

    it('cada mensaje nuevo reinicia la espera', async () => {
      withReplyDelay(300);
      await sendNow(text('Hola'));
      await new Promise((r) => setTimeout(r, 200));
      await sendNow(text('una consulta'));
      await new Promise((r) => setTimeout(r, 200));
      expect(whatsapp.sent).toHaveLength(0); // pasaron 400 ms desde el primero, pero solo 200 desde el último
      await conversation().whenIdle();
      expect(llm.calls).toHaveLength(1);
    });

    it('si escribe mientras se genera la respuesta, después se contesta lo nuevo', async () => {
      let release!: () => void;
      const slow = new Promise<void>((r) => (release = r));
      const original = llm.reply.bind(llm);
      const spy = jest.spyOn(llm, 'reply').mockImplementationOnce(async (system, history) => {
        await slow; // Claude "pensando"
        return original(system, history);
      });
      try {
        llm.willReply({ text: 'Hola, ¿qué buscás?' }, { text: 'Perfecto, casas en Funes.' });
        await sendNow(text('Hola'));
        await new Promise((r) => setTimeout(r, 50)); // ya está esperando a Claude
        await sendNow(text('busco casa en Funes'));
        release();
        await conversation().whenIdle();
      } finally {
        spy.mockRestore();
      }
      expect(whatsapp.sent.map((m) => m.text)).toEqual(['Hola, ¿qué buscás?', 'Perfecto, casas en Funes.']);
      expect(llm.calls[1].history.at(-1)).toEqual({ role: 'user', content: 'busco casa en Funes' });
    });

    it('si un asesor contesta durante la espera, el asistente no responde', async () => {
      await receive(text('Hola')); // primer mensaje: abre la ventana de 24 h
      const lead = (await leadByPhone())!;
      withReplyDelay(300);
      llm.reset();
      whatsapp.reset();
      await sendNow(text('¿Me llaman?'));
      await http(app).post(`/leads/${lead.id}/messages`).set(agent.auth).send({ text: 'Te llamo en 5 minutos' }).expect(201);
      await conversation().whenIdle();
      expect(llm.calls).toHaveLength(0);
      expect(whatsapp.sent).toEqual([{ to: CLIENT, text: 'Te llamo en 5 minutos' }]);
    });

    it('un sticker junto con texto: contesta Claude (una vez), no el mensaje fijo', async () => {
      withReplyDelay(300);
      llm.willReply({ text: '¡Jaja! Contame qué buscás.' });
      await sendNow({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'unsupported', type: 'sticker' });
      await sendNow(text('Hola!'));
      await conversation().whenIdle();
      expect(whatsapp.sent.map((m) => m.text)).toEqual(['¡Jaja! Contame qué buscás.']);
      expect(llm.calls[0].history[0].content).toEqual([
        { type: 'text', text: '[El cliente mandó un sticker]' },
        { type: 'text', text: 'Hola!' },
      ]);
    });

    it('si la API se reinició durante la espera, al arrancar contesta lo pendiente', async () => {
      await receive(text('Hola'));
      const lead = (await leadByPhone())!;
      // Mensaje guardado cuya respuesta se perdió con el reinicio
      await db().getRepository(ChatHistory).save({ lead, role: 'user' as never, content: '¿Siguen ahí?', externalMessageId: 'wamid.perdido' });
      llm.willReply({ text: 'Sí, acá estamos.' });
      await conversation().onApplicationBootstrap();
      await conversation().whenIdle();
      expect(whatsapp.sent.at(-1)).toEqual({ to: CLIENT, text: 'Sí, acá estamos.' });

      // Ya respondido: un nuevo arranque no vuelve a contestar
      const sent = whatsapp.sent.length;
      await conversation().onApplicationBootstrap();
      await conversation().whenIdle();
      expect(whatsapp.sent).toHaveLength(sent);
    });
  });

  describe('lo que recibe Claude', () => {
    it('la conversación previa en orden y las propiedades del inventario que coinciden', async () => {
      await createProperty(app, agent, 'Depto luminoso en Centro');
      llm.willReply({ text: 'Hola, ¿qué buscás?' }, { text: 'Tengo este depto en Centro.' });
      await receive(text('Hola'));
      await receive(text('Busco algo en Centro'));

      const { system, history } = llm.calls[1];
      expect(history).toEqual([
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: 'Hola, ¿qué buscás?' },
        { role: 'user', content: 'Busco algo en Centro' },
      ]);
      expect(system).toContain('Depto luminoso en Centro');
    });

    it('lo que escribió un asesor desde el CRM cuenta como respuesta de la inmobiliaria', async () => {
      await receive(text('Hola'));
      const lead = await leadByPhone();
      await http(app).post(`/leads/${lead!.id}/messages`).set(agent.auth).send({ text: 'Hola, soy Ana' }).expect(201);
      await http(app).patch(`/leads/${lead!.id}`).set(agent.auth).send({ aiPaused: false }).expect(200);
      await receive(text('Gracias Ana'));

      // La respuesta del asistente y la de Ana van juntas en el turno de la inmobiliaria
      expect(llm.calls[1].history).toEqual([
        { role: 'user', content: 'Hola' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Respuesta de prueba' },
            { type: 'text', text: 'Hola, soy Ana' },
          ],
        },
        { role: 'user', content: 'Gracias Ana' },
      ]);
    });
  });

  describe('herramientas', () => {
    it('update_lead_profile completa la búsqueda del lead sin duplicar barrios', async () => {
      await receive(text('Hola'));
      llm.willReply({
        text: 'Anotado.',
        toolCalls: [
          {
            name: 'update_lead_profile',
            input: { full_name: 'Juan Pérez', operation: 'venta', budget_max_usd: 120000, neighborhoods: ['Centro', 'Centro', 'Echesortu'], min_rooms: 2, needs_garage: true, urgency: 3 },
          },
        ],
      });
      await receive(text('Soy Juan, quiero comprar en Centro o Echesortu hasta 120 mil, 2 ambientes con cochera, urgente'));

      const lead = await leadByPhone();
      expect(lead).toMatchObject({
        fullName: 'Juan Pérez',
        wantsOperation: 'venta',
        budgetMaxUsd: 120000,
        preferredNeighborhoods: ['Centro', 'Echesortu'],
        minRooms: 2,
        needsGarage: true,
        urgency: 1, // se acota a 0..1
      });
      expect(whatsapp.sent.at(-1)?.text).toBe('Anotado.');
    });

    it('si Claude manda datos con formato inválido, se ignoran y el cliente igual recibe la respuesta', async () => {
      await receive(text('Hola'));
      llm.willReply({
        text: 'Perfecto, lo anoto.',
        toolCalls: [
          {
            name: 'update_lead_profile',
            input: { operation: 'comprar', budget_max_usd: 'unos 100 mil', neighborhoods: 'Centro', min_rooms: 'dos', urgency: 'alta', full_name: 42 },
          },
        ],
      });
      await receive(text('Quiero comprar'));

      expect(whatsapp.sent.at(-1)?.text).toBe('Perfecto, lo anoto.');
      const lead = await leadByPhone();
      expect(lead).toMatchObject({ preferredNeighborhoods: [], urgency: 0 });
      expect(lead!.wantsOperation).toBeNull();
      expect(lead!.budgetMaxUsd).toBeNull();
      expect(lead!.minRooms).toBeNull();
    });

    it('schedule_visit deja una visita pendiente y avisa al asesor', async () => {
      const property = await createProperty(app, agent);
      await receive(text('Hola'));
      const start = new Date(Date.now() + 2 * 24 * 3600_000);
      start.setUTCHours(14, 0, 0, 0);
      llm.willReply({ text: 'Te agendé la visita.', toolCalls: [{ name: 'schedule_visit', input: { property_id: property.id, start_iso: start.toISOString() } }] });
      await receive(text('El jueves a las 11 me viene bien'));

      const visits = await db().getRepository(Visit).find({ relations: { lead: true } });
      expect(visits).toHaveLength(1);
      expect(visits[0]).toMatchObject({ status: 'pendiente', source: 'asistente' });
      expect((await leadByPhone())!.stage).toBe('visita_agendada');
      expect(await notificationsOf(agent)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'visita_por_confirmar' })]));
    });

    it('si la visita no se puede agendar queda una nota en el chat para el asesor', async () => {
      const property = await createProperty(app, agent);
      await receive(text('Hola'));
      llm.willReply({ text: 'Listo.', toolCalls: [{ name: 'schedule_visit', input: { property_id: property.id, start_iso: '2020-03-01T10:00:00-03:00' } }] });
      await receive(text('El 1 de marzo'));

      const chat = await chatOf((await leadByPhone())!.id);
      expect(chat.find((c) => c.role === 'system')?.content).toMatch(/No se pudo agendar.*ya pasó/);
      expect(await db().getRepository(Visit).count()).toBe(0);
      expect(whatsapp.sent.at(-1)?.text).toBe('Listo.');
    });

    it('handoff_to_agent pausa al asistente: los mensajes siguientes le llegan al asesor y Claude no contesta', async () => {
      await receive(text('Hola'));
      llm.willReply({ text: 'Te paso con un asesor.', toolCalls: [{ name: 'handoff_to_agent', input: { reason: 'Quiere negociar el precio' } }] });
      await receive(text('¿Me hacen descuento?'));

      const lead = await leadByPhone();
      expect(lead!.aiPaused).toBe(true);
      const waiting = async () => (await notificationsOf(agent)).filter((n: { type: string }) => n.type === 'cliente_esperando');
      expect(await waiting()).toEqual([expect.objectContaining({ body: 'Quiere negociar el precio', leadId: lead!.id })]);

      const before = { llm: llm.calls.length, sent: whatsapp.sent.length };
      await receive(text('¿Hola? ¿Alguien?'));
      await receive(text('Sigo esperando'));
      expect(llm.calls).toHaveLength(before.llm);
      expect(whatsapp.sent).toHaveLength(before.sent);

      // Un solo aviso sin leer por lead, con el último mensaje (no uno por cada mensaje)
      const notes = await waiting();
      expect(notes).toHaveLength(1);
      expect(notes[0].body).toBe('Sigo esperando');
    });
  });

  describe('cuando algo falla', () => {
    it('si Claude no responde, el cliente recibe un mensaje de disculpas', async () => {
      llm.willReply(new Error('overloaded_error'));
      await receive(text('Hola'));
      expect(whatsapp.sent[0].text).toMatch(/tuve un problemita/);
    });

    it('si Claude solo usa una herramienta sin texto, se responde algo igual', async () => {
      llm.willReply({ text: '', toolCalls: [{ name: 'update_lead_profile', input: { min_rooms: 3 } }] });
      await receive(text('Busco 3 ambientes'));
      expect(whatsapp.sent[0].text).toMatch(/Ya lo dejé anotado/);
    });

    it('si WhatsApp no deja enviar la respuesta, la conversación queda guardada igual', async () => {
      whatsapp.failSending = true;
      llm.willReply({ text: 'Hola!' });
      await expect(receive(text('Hola'))).resolves.toBeUndefined();
      const chat = await chatOf((await leadByPhone())!.id);
      expect(chat.map((c) => c.role)).toEqual(['user', 'assistant']);
    });
  });

  describe('audios, fotos y otros', () => {
    it('un audio transcripto se guarda y Claude lo recibe como texto', async () => {
      whatsapp.media.set('audio-1', { data: Buffer.from('OggS-audio-falso'), mimeType: 'audio/ogg; codecs=opus' });
      transcriber.result = 'Hola, busco casa en Fisherton';
      await receive({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'audio', mediaId: 'audio-1' });

      const [msg] = await chatOf((await leadByPhone())!.id);
      expect(msg).toMatchObject({ mediaType: 'audio', content: 'Hola, busco casa en Fisherton', mediaMime: 'audio/ogg; codecs=opus' });
      expect(msg.mediaFile).toMatch(/\.ogg$/);
      expect(llm.calls[0].history).toEqual([{ role: 'user', content: '[Audio transcripto] Hola, busco casa en Fisherton' }]);
    });

    it('un audio que no se pudo transcribir recibe una respuesta fija, sin llamar a Claude', async () => {
      whatsapp.media.set('audio-2', { data: Buffer.from('x'), mimeType: 'audio/ogg' });
      await receive({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'audio', mediaId: 'audio-2' });
      expect(llm.calls).toHaveLength(0);
      expect(whatsapp.sent[0].text).toMatch(/no lo puedo escuchar/);
    });

    it('una foto se guarda achicada y sin GPS, y Claude la ve como imagen', async () => {
      const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#336699' } })
        .jpeg()
        .withExif({ IFD0: { Make: 'Celular' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '32/1 57/1 0/1' } })
        .toBuffer();
      expect((await sharp(photo).metadata()).exif).toBeDefined();
      whatsapp.media.set('foto-1', { data: photo, mimeType: 'image/jpeg' });
      await receive({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'image', mediaId: 'foto-1', caption: '¿Tienen algo así?' });

      const [msg] = await chatOf((await leadByPhone())!.id);
      const stored = await app.get(ChatMediaStorage).read(msg.mediaFile!);
      const meta = await sharp(stored).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBe(1568);
      expect(meta.exif).toBeUndefined();

      const [turn] = llm.calls[0].history;
      expect(turn.content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: stored.toString('base64') } },
        { type: 'text', text: 'El cliente mandó esta foto con el texto: "¿Tienen algo así?"' },
      ]);
    });

    it('una foto rota recibe una respuesta fija', async () => {
      whatsapp.media.set('foto-rota', { data: Buffer.from('no es una imagen'), mimeType: 'image/jpeg' });
      await receive({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'image', mediaId: 'foto-rota' });
      expect(llm.calls).toHaveLength(0);
      expect(whatsapp.sent[0].text).toMatch(/No pude abrir la foto/);
    });

    it('stickers, videos, etc.: le pide que escriba, sin llamar a Claude', async () => {
      await receive({ wamid: `wamid.in.${++seq}`, from: CLIENT, kind: 'unsupported', type: 'sticker' });
      expect(llm.calls).toHaveLength(0);
      expect(whatsapp.sent[0].text).toMatch(/texto, audios y fotos/);
      const [msg] = await chatOf((await leadByPhone())!.id);
      expect(msg.content).toBe('[El cliente mandó un sticker]');
    });
  });

  describe('mensajes del asesor desde el CRM', () => {
    async function leadWithChat() {
      await receive(text('Hola'));
      return (await leadByPhone())!;
    }
    const send = (leadId: string, body: string) => http(app).post(`/leads/${leadId}/messages`).set(agent.auth).send({ text: body });

    it('se envía por WhatsApp, pausa al asistente y marca como leídos los avisos del lead', async () => {
      const lead = await leadWithChat();
      llm.willReply({ text: 'Te paso con alguien', toolCalls: [{ name: 'handoff_to_agent', input: { reason: 'Pidió hablar con una persona' } }] });
      await receive(text('Quiero hablar con alguien'));
      expect((await notificationsOf(agent))[0].readAt).toBeNull();

      const res = await send(lead.id, '  Hola Juan, soy Ana  ').expect(201);
      expect(res.body).toMatchObject({ role: 'agent', content: 'Hola Juan, soy Ana', authorName: 'Ana' });
      expect(whatsapp.sent.at(-1)).toEqual({ to: CLIENT, text: 'Hola Juan, soy Ana' });
      expect((await leadByPhone())!.aiPaused).toBe(true);
      expect((await notificationsOf(agent))[0].readAt).not.toBeNull();
    });

    it('pasadas 24 h del último mensaje del cliente no deja escribir (regla de WhatsApp)', async () => {
      const lead = await leadWithChat();
      await db().query(`UPDATE chat_history SET created_at = now() - interval '25 hours' WHERE lead_id = $1`, [lead.id]);
      const res = await send(lead.id, 'Hola?').expect(409);
      expect(res.body.message).toMatch(/24 h/);
      const window = await http(app).get(`/leads/${lead.id}/messages/window`).set(agent.auth).expect(200);
      expect(window.body).toMatchObject({ open: false, templateAvailable: false });
    });

    it('si WhatsApp rechaza el mensaje, el asesor ve el motivo y no se guarda nada', async () => {
      const lead = await leadWithChat();
      whatsapp.failSending = true;
      const res = await send(lead.id, 'Hola').expect(502);
      expect(res.body.message).toMatch(/WhatsApp no aceptó el mensaje/);
      expect((await chatOf(lead.id)).filter((c) => c.role === 'agent')).toHaveLength(0);
    });

    it('manda la ficha PDF de una propiedad como documento', async () => {
      const lead = await leadWithChat();
      const property = await createProperty(app, agent, 'Depto Centro');
      const res = await http(app)
        .post(`/leads/${lead.id}/messages/sheet`)
        .set(agent.auth)
        .send({ propertyId: property.id, caption: ' Te paso la ficha ', agencyName: 'Inmobiliaria Ejemplo' })
        .expect(201);

      const [upload] = whatsapp.uploads;
      expect(upload.mimeType).toBe('application/pdf');
      expect(upload.data.subarray(0, 5).toString()).toBe('%PDF-');
      expect(whatsapp.documents).toEqual([{ to: CLIENT, mediaId: upload.mediaId, filename: 'ficha-depto-centro.pdf', caption: 'Te paso la ficha' }]);
      expect(res.body).toMatchObject({ role: 'agent', content: '📄 Ficha: Depto Centro\nTe paso la ficha', authorName: 'Ana' });
      expect((await leadByPhone())!.aiPaused).toBe(true);

      // Fuera de la ventana de 24 h, tampoco
      await db().query(`UPDATE chat_history SET created_at = now() - interval '25 hours' WHERE lead_id = $1`, [lead.id]);
      await http(app).post(`/leads/${lead.id}/messages/sheet`).set(agent.auth).send({ propertyId: property.id }).expect(409);
      await http(app).post(`/leads/${lead.id}/messages/sheet`).set(agent.auth).send({ propertyId: 'x' }).expect(400);
    });

    it('si WhatsApp no acepta el PDF, avisa y no se guarda nada', async () => {
      const lead = await leadWithChat();
      const property = await createProperty(app, agent);
      whatsapp.failSending = true;
      const res = await http(app).post(`/leads/${lead.id}/messages/sheet`).set(agent.auth).send({ propertyId: property.id }).expect(502);
      expect(res.body.message).toMatch(/WhatsApp no aceptó la ficha/);
      expect((await chatOf(lead.id)).filter((c) => c.role === 'agent')).toHaveLength(0);
    });

    it('mensaje vacío: 400', async () => {
      const lead = await leadWithChat();
      await send(lead.id, '   ').expect(400);
    });

    describe('plantilla para retomar', () => {
      afterEach(() => {
        delete process.env.WHATSAPP_REENGAGE_TEMPLATE;
      });

      it('sin plantilla configurada lo explica', async () => {
        const lead = await leadWithChat();
        const res = await http(app).post(`/leads/${lead.id}/messages/template`).set(agent.auth).expect(422);
        expect(res.body.message).toMatch(/WHATSAPP_REENGAGE_TEMPLATE/);
      });

      it('con la ventana cerrada manda la plantilla con el nombre de pila, y no deja mandar otra hasta que conteste', async () => {
        process.env.WHATSAPP_REENGAGE_TEMPLATE = 'retomar_busqueda';
        await receive(text('Hola', CLIENT, 'Juan Pérez'));
        const lead = (await leadByPhone())!;
        const url = `/leads/${lead.id}/messages/template`;

        await http(app).post(url).set(agent.auth).expect(409); // ventana abierta: mensaje normal
        await db().query(`UPDATE chat_history SET created_at = now() - interval '25 hours' WHERE lead_id = $1`, [lead.id]);

        await http(app).post(url).set(agent.auth).expect(201);
        expect(whatsapp.templates).toEqual([{ to: CLIENT, name: 'retomar_busqueda', language: 'es_AR', params: ['Juan'] }]);
        await http(app).post(url).set(agent.auth).expect(409);

        // El cliente contesta: se reabre la ventana y lo atiende el asesor (asistente pausado)
        const callsBefore = llm.calls.length;
        await receive(text('Sí, sigo buscando'));
        expect(llm.calls).toHaveLength(callsBefore);
        const window = await http(app).get(`/leads/${lead.id}/messages/window`).set(agent.auth).expect(200);
        expect(window.body).toMatchObject({ open: true, templatePending: false });
      });
    });
  });

  it('de punta a punta: un mensaje firmado que llega al webhook termina respondido', async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'María' } }],
                messages: [{ id: 'wamid.webhook.1', from: '5491144445555', type: 'text', text: { body: 'Hola!' } }],
              },
            },
          ],
        },
      ],
    });
    llm.willReply({ text: 'Hola María' });
    await http(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=' + createHmac('sha256', 'app-secret-de-prueba').update(body).digest('hex'))
      .send(body)
      .expect(200);

    // Se procesa en segundo plano: se espera a que aparezca la respuesta.
    for (let i = 0; i < 50 && !whatsapp.sent.length; i++) await new Promise((r) => setTimeout(r, 100));
    expect(whatsapp.sent).toEqual([{ to: '5491144445555', text: 'Hola María' }]);
    expect(await leadByPhone('+5491144445555')).toMatchObject({ fullName: 'María' });
  });
});
