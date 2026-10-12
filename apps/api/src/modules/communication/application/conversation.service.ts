import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { User } from '../../auth/domain/user.entity';
import { MatchingService } from '../../lead-engine/application/matching.service';
import { LeadAssignmentService } from '../../leads/application/lead-assignment.service';
import { Lead } from '../../leads/domain/lead.entity';
import { OperationType } from '../../properties/domain/property.enums';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationType } from '../../notifications/domain/notification.entity';
import { VisitsService } from '../../visits/application/visits.service';
import { ChatChannel, ChatHistory, ChatRole } from '../domain/chat-history.entity';
import { LlmClient, LlmToolCall } from '../infrastructure/llm.client';
import { InventoryRagService } from '../infrastructure/rag.service';
import { buildSystemPrompt } from '../infrastructure/system-prompt';
import { WhatsAppClient, WhatsAppSendError } from '../infrastructure/whatsapp.client';
import { AudioTranscriber } from '../infrastructure/audio-transcriber';
import { ChatMediaStorage } from '../infrastructure/chat-media.storage';

/** Mensaje entrante ya parseado del webhook. */
export type IncomingMessage = {
  wamid: string;
  from: string; // E.164 sin "+": 5493415551234
  name?: string;
} & (
  | { kind: 'text'; text: string }
  | { kind: 'audio'; mediaId: string }
  | { kind: 'image'; mediaId: string; caption?: string }
  | { kind: 'location'; latitude: number; longitude: number; label?: string }
  /** video, documento, sticker, contacto...: se registra y se le pide que escriba. */
  | { kind: 'unsupported'; type: string }
);

/** Lo que se guarda del mensaje del cliente, y una respuesta fija si no hace falta (o no se puede) llamar al LLM. */
interface Received {
  content: string;
  mediaType?: 'audio' | 'image';
  mediaFile?: string;
  mediaMime?: string;
  autoReply?: string;
}

const MAX_AUDIO_BYTES = 16 * 1024 * 1024; // límite de WhatsApp para audios
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Lado mayor de las fotos que se guardan y se mandan a Claude (más grande no mejora y cuesta más tokens). */
const IMAGE_MAX_SIDE = 1568;
/** Solo las fotos más recientes viajan como imagen al LLM; las anteriores, como texto. */
const IMAGES_IN_CONTEXT = 2;

const UNSUPPORTED_LABEL: Record<string, string> = {
  video: 'un video',
  document: 'un documento',
  sticker: 'un sticker',
  contacts: 'un contacto',
  reaction: 'una reacción',
};

const AUDIO_EXT: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/aac': 'aac' };

/** WhatsApp solo permite texto libre hasta 24 h después del último mensaje del cliente; después, plantillas aprobadas. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MessagingWindow {
  /** Se puede escribir texto libre. */
  open: boolean;
  /** Hasta cuándo (si está abierta). */
  closesAt: Date | null;
  /** Hay una plantilla de reenganche configurada en WHATSAPP_REENGAGE_TEMPLATE. */
  templateAvailable: boolean;
  /** Se mandó una plantilla y el cliente todavía no contestó: no tiene sentido (ni es gratis) mandar otra. */
  templatePending: boolean;
}

/** Texto que representa un mensaje del cliente (avisos, historial viejo, búsqueda en el inventario). */
function describe(c: Pick<ChatHistory, 'content' | 'mediaType'>): string {
  if (c.mediaType === 'audio') return c.content ? `[Audio transcripto] ${c.content}` : '[Audio que no se pudo transcribir]';
  if (c.mediaType === 'image') return c.content ? `[Foto] ${c.content}` : '[Foto sin texto]';
  return c.content || '(mensaje vacío)';
}

const excerpt = (text: string) => (text.length > 140 ? `${text.slice(0, 137)}…` : text);

/** Código de PostgreSQL para "ya existe" (índice único). */
const UNIQUE_VIOLATION = '23505';

/** Número que manda el modelo: acepta 120000 o "120000"; cualquier otra cosa (texto, NaN) da null. */
function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Cuánto se espera por si el cliente sigue escribiendo antes de contestar (WHATSAPP_REPLY_DELAY_MS). */
const DEFAULT_REPLY_DELAY_MS = 4000;

interface PendingReply {
  timer?: NodeJS.Timeout;
  /** Se está generando la respuesta (LLM). */
  running: boolean;
  /** Llegó otro mensaje mientras se generaba: hay que volver a contestar. */
  again: boolean;
  done: Promise<void>;
  resolve: () => void;
}

/**
 * Agrega un turno al historial. Varios mensajes seguidos del cliente van en un solo turno (un bloque por mensaje):
 * la conversación con el LLM alterna cliente / inmobiliaria.
 */
function appendTurn(history: Anthropic.MessageParam[], turn: Anthropic.MessageParam): void {
  const last = history.at(-1);
  if (!last || last.role !== turn.role) {
    history.push(turn);
    return;
  }
  const blocks = (c: Anthropic.MessageParam['content']): Anthropic.ContentBlockParam[] =>
    typeof c === 'string' ? [{ type: 'text', text: c }] : c;
  last.content = [...blocks(last.content), ...blocks(turn.content)];
}

/** Momento de un mensaje en la conversación: las respuestas del asistente cuentan desde lo último que contestaron. */
function conversationTime(c: ChatHistory): number {
  const until = c.role === ChatRole.ASSISTANT ? c.extractedData?.answeredUntil : undefined;
  return typeof until === 'string' ? Date.parse(until) + 0.5 : c.createdAt.getTime();
}

const FALLBACK = 'Uy, tuve un problemita para responderte. Dame un ratito y probá de nuevo, o te contacta un asesor.';

@Injectable()
export class ConversationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConversationService.name);
  /** Respuestas en espera, por lead. En memoria: la API corre en una sola instancia (ver onApplicationBootstrap). */
  private readonly pending = new Map<string, PendingReply>();

  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(ChatHistory) private readonly chats: Repository<ChatHistory>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly rag: InventoryRagService,
    private readonly llm: LlmClient,
    private readonly whatsapp: WhatsAppClient,
    private readonly visits: VisitsService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly assignment: LeadAssignmentService,
    private readonly media: ChatMediaStorage,
    private readonly transcriber: AudioTranscriber,
  ) {}

  async handleIncoming(msg: IncomingMessage): Promise<void> {
    // 1) Idempotencia: Meta reintenta webhooks; no procesamos dos veces el mismo mensaje.
    const dup = await this.chats.exist({ where: { externalMessageId: msg.wamid } });
    if (dup) return;

    // 2) Lead por teléfono (se crea si es nuevo)
    const lead = await this.findOrCreateLead(`+${msg.from}`, msg.name);

    // 3) Contenido: texto tal cual; audios transcriptos; fotos guardadas (privadas) para el CRM y el LLM.
    const received = await this.receive(msg);
    let userChat: ChatHistory;
    try {
      userChat = await this.chats.save(
        this.chats.create({
          lead,
          channel: ChatChannel.WHATSAPP,
          role: ChatRole.USER,
          content: received.content,
          mediaType: received.mediaType,
          mediaFile: received.mediaFile,
          mediaMime: received.mediaMime,
          externalMessageId: msg.wamid,
          // Respuesta fija para este mensaje si no hay nada que el LLM pueda leer (ver answer()).
          extractedData: received.autoReply ? { autoReply: received.autoReply } : undefined,
        }),
      );
    } catch (err: any) {
      // Meta reenvió el mismo mensaje mientras se procesaba el primero: ya lo está atendiendo el otro.
      if (err?.code === UNIQUE_VIOLATION) return;
      throw err;
    }
    await this.whatsapp.markAsRead(msg.wamid);

    // Lo está atendiendo un asesor: el mensaje queda en el historial y el asistente no contesta.
    if (lead.aiPaused) {
      lead.lastInteractionAt = new Date();
      await this.leads.save(lead);
      await this.notifications.notify(
        NotificationType.CLIENTE_ESPERANDO,
        `${this.nameOf(lead)} te escribió`,
        excerpt(describe(userChat)),
        lead.id,
      );
      await this.rescore(lead.id);
      return;
    }

    // 4) No se contesta enseguida: la gente escribe en varios mensajes cortos ("Hola" / "busco depto" / "en Centro").
    this.scheduleReply(lead.id);
  }

  /** Espera antes de contestar; cada mensaje nuevo del mismo cliente reinicia la espera. */
  private replyDelayMs(): number {
    const ms = Number(this.config.get('WHATSAPP_REPLY_DELAY_MS') ?? DEFAULT_REPLY_DELAY_MS);
    return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_REPLY_DELAY_MS;
  }

  private scheduleReply(leadId: string): void {
    let pending = this.pending.get(leadId);
    if (!pending) {
      let resolve!: () => void;
      const done = new Promise<void>((r) => (resolve = r));
      pending = { running: false, again: false, done, resolve };
      this.pending.set(leadId, pending);
    }
    // Llegó un mensaje mientras se generaba la respuesta: al terminar se vuelve a esperar y se contesta lo nuevo.
    if (pending.running) {
      pending.again = true;
      return;
    }
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => void this.runReply(leadId), this.replyDelayMs());
  }

  private async runReply(leadId: string): Promise<void> {
    const pending = this.pending.get(leadId);
    if (!pending) return;
    pending.timer = undefined;
    pending.running = true;
    try {
      await this.answer(leadId);
    } catch (err) {
      this.logger.error(`No se pudo responder al lead ${leadId}: ${(err as Error).message}`);
    }
    pending.running = false;
    if (pending.again) {
      pending.again = false;
      pending.timer = setTimeout(() => void this.runReply(leadId), this.replyDelayMs());
      return;
    }
    this.pending.delete(leadId);
    pending.resolve();
  }

  /** Para los tests: espera a que no quede ninguna respuesta pendiente. */
  async whenIdle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending.values()].map((p) => p.done));
  }

  /**
   * Si la API se reinició durante la espera (deploy), esas respuestas se perdieron: al arrancar se contestan los
   * clientes cuyo último mensaje es de los últimos minutos y todavía no tiene respuesta.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows: { leadId: string }[] = await this.chats.query(
        `SELECT last.lead_id AS "leadId"
           FROM (SELECT DISTINCT ON (c.lead_id) c.lead_id, c.role
                   FROM chat_history c
                  WHERE c.channel = 'whatsapp' AND c.role <> 'system' AND c.created_at > now() - interval '15 minutes'
                  ORDER BY c.lead_id, c.created_at DESC) last
           JOIN leads l ON l.id = last.lead_id
          WHERE last.role = 'user' AND NOT l.ai_paused`,
      );
      for (const { leadId } of rows) this.scheduleReply(leadId);
      if (rows.length) this.logger.log(`Respondiendo ${rows.length} conversación(es) que quedaron sin respuesta al reiniciar`);
    } catch (err) {
      this.logger.error(`No se pudieron recuperar las respuestas pendientes: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
  }

  /** Contesta todos los mensajes del cliente que llegaron desde la última respuesta, en una sola respuesta. */
  private async answer(leadId: string): Promise<void> {
    // Se relee: mientras se esperaba, un asesor pudo haber pausado al asistente o escrito él.
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead?.phone || lead.aiPaused) return;

    // Orden de la conversación: cada respuesta del asistente va después del último mensaje que contestó, aunque se
    // haya guardado más tarde (si el cliente escribió mientras Claude pensaba, eso queda para la próxima respuesta).
    const recent = (await this.chats.find({ where: { lead: { id: lead.id } }, order: { createdAt: 'DESC' }, take: 12 }))
      .filter((c) => c.role !== ChatRole.SYSTEM)
      .sort((a, b) => conversationTime(a) - conversationTime(b));
    const lastReply = recent.map((c) => c.role !== ChatRole.USER).lastIndexOf(true);
    const unanswered = recent.slice(lastReply + 1);
    if (!unanswered.length) return; // ya se contestó (o lo contestó un asesor)
    const answeredUntil = unanswered.at(-1)!.createdAt.toISOString();

    const to = lead.phone.replace(/^\+/, '');
    // Audio que no se pudo escuchar, sticker, video...: si es lo único que mandó, respuesta fija sin gastar una llamada al LLM.
    const autoReplies = unanswered.map((c) => c.extractedData?.autoReply).filter((r): r is string => typeof r === 'string');
    if (autoReplies.length === unanswered.length) {
      await this.reply(lead, to, autoReplies.at(-1)!, { answeredUntil });
      return;
    }

    // Historial reciente + RAG sobre el inventario
    const imageIds = new Set(recent.filter((c) => c.mediaType === 'image' && c.mediaFile).slice(-IMAGES_IN_CONTEXT).map((c) => c.id));
    const history: Anthropic.MessageParam[] = [];
    for (const c of recent) appendTurn(history, await this.toLlmMessage(c, imageIds.has(c.id)));
    // El recorte de 12 mensajes puede dejar respuestas al principio: la conversación tiene que arrancar con el cliente.
    while (history.length && history[0].role !== 'user') history.shift();

    // Contexto: lo que escribió ahora + lo que ya sabemos de su búsqueda
    const ragQuery = [...unanswered.map((c) => c.content), ...(lead.preferredNeighborhoods ?? [])].join(' ');
    const inventory = await this.rag.retrieve(ragQuery);
    const system = buildSystemPrompt(inventory, new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }));

    // LLM
    let answer = FALLBACK;
    let toolCalls: LlmToolCall[] = [];
    try {
      const reply = await this.llm.reply(system, history);
      toolCalls = reply.toolCalls;
      if (reply.text) answer = reply.text;
      else if (toolCalls.length) answer = '¡Listo! Ya lo dejé anotado. ¿Querés que te muestre algo más?';
    } catch (err) {
      this.logger.error(`LLM falló: ${(err as Error).message}`);
    }

    // Efectos de las herramientas (perfil / cita / derivación). Si una falla, el cliente igual recibe la respuesta.
    for (const call of toolCalls) {
      try {
        await this.applyTool(lead, call);
      } catch (err) {
        this.logger.error(`No se pudo aplicar ${call.name} al lead ${lead.id}: ${(err as Error).message}`);
      }
    }

    // Guardar y enviar respuesta
    await this.reply(lead, to, answer, toolCalls.length ? { toolCalls, answeredUntil } : { answeredUntil });
    // Lo que contó en el chat (presupuesto, urgencia...) cambia su puntaje y temperatura.
    await this.rescore(lead.id);
  }

  /**
   * Lead por teléfono; si es nuevo se crea y se reparte. Meta suele entregar juntos varios mensajes seguidos de un
   * número nuevo: si otro de esos mensajes lo creó un instante antes, se usa ese.
   */
  private async findOrCreateLead(phone: string, name?: string): Promise<Lead> {
    const existing = await this.leads.findOne({ where: { phone } });
    if (existing) return existing;
    let lead: Lead;
    try {
      lead = await this.leads.save(this.leads.create({ phone, fullName: name }));
    } catch (err: any) {
      if (err?.code !== UNIQUE_VIOLATION) throw err;
      return this.leads.findOneOrFail({ where: { phone } });
    }
    await this.assignment.autoAssign(lead);
    return lead;
  }

  private async reply(lead: Lead, to: string, text: string, extractedData?: Record<string, unknown>): Promise<void> {
    await this.chats.save(
      this.chats.create({ lead, channel: ChatChannel.WHATSAPP, role: ChatRole.ASSISTANT, content: text, extractedData }),
    );
    try {
      await this.whatsapp.sendText(to, text);
    } catch {
      // ya quedó registrado en el log del cliente de WhatsApp; igual se actualiza el lead
    }
    lead.lastInteractionAt = new Date();
    await this.leads.save(lead);
  }

  private async receive(msg: IncomingMessage): Promise<Received> {
    switch (msg.kind) {
      case 'text':
        return { content: msg.text };

      case 'location': {
        const where = msg.label ? `${msg.label} ` : '';
        return { content: `[Ubicación compartida: ${where}(${msg.latitude}, ${msg.longitude})]` };
      }

      case 'unsupported':
        return {
          content: `[El cliente mandó ${UNSUPPORTED_LABEL[msg.type] ?? 'un archivo'}]`,
          autoReply: 'Por ahora puedo leer mensajes de texto, audios y fotos. ¿Me contás por escrito lo que necesitás?',
        };

      case 'audio': {
        const sorry = '¡Gracias por el audio! Justo ahora no lo puedo escuchar. ¿Me lo escribís así te ayudo?';
        try {
          const { data, mimeType } = await this.whatsapp.downloadMedia(msg.mediaId, MAX_AUDIO_BYTES);
          const ext = AUDIO_EXT[mimeType.split(';')[0].trim()] ?? 'bin';
          const mediaFile = await this.media.save(data, ext);
          const transcript = await this.transcriber.transcribe(data, mimeType, `audio.${ext}`);
          return { content: transcript ?? '', mediaType: 'audio', mediaFile, mediaMime: mimeType, autoReply: transcript ? undefined : sorry };
        } catch (err) {
          this.logger.error(`No se pudo bajar el audio ${msg.mediaId}: ${(err as Error).message}`);
          return { content: '', mediaType: 'audio', autoReply: sorry };
        }
      }

      case 'image': {
        try {
          const { data } = await this.whatsapp.downloadMedia(msg.mediaId, MAX_IMAGE_BYTES);
          // Se achica y se pasa a JPG sin metadatos (las fotos de celular traen la ubicación GPS).
          const jpg = await sharp(data, { limitInputPixels: 80_000_000 })
            .rotate()
            .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          const mediaFile = await this.media.save(jpg, 'jpg');
          return { content: msg.caption?.trim() ?? '', mediaType: 'image', mediaFile, mediaMime: 'image/jpeg' };
        } catch (err) {
          this.logger.error(`No se pudo procesar la foto ${msg.mediaId}: ${(err as Error).message}`);
          return {
            content: msg.caption?.trim() ?? '',
            mediaType: 'image',
            autoReply: 'No pude abrir la foto que me mandaste. ¿Me la mandás de nuevo, o me contás qué querías mostrarme?',
          };
        }
      }
    }
  }

  /** Un mensaje del historial en el formato del LLM. Lo que escribió un asesor también es "la inmobiliaria" (assistant). */
  private async toLlmMessage(c: ChatHistory, withImage: boolean): Promise<Anthropic.MessageParam> {
    if (c.role !== ChatRole.USER) return { role: 'assistant', content: c.content || '(sin texto)' };
    if (withImage && c.mediaFile) {
      try {
        const data = (await this.media.read(c.mediaFile)).toString('base64');
        const text = c.content ? `El cliente mandó esta foto con el texto: "${c.content}"` : 'El cliente mandó esta foto.';
        return {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text },
          ],
        };
      } catch (err) {
        this.logger.warn(`No se pudo leer la foto ${c.mediaFile}: ${(err as Error).message}`);
      }
    }
    return { role: 'user', content: describe(c) };
  }

  async windowStatus(leadId: string): Promise<MessagingWindow> {
    if (!(await this.leads.exists({ where: { id: leadId } }))) throw new NotFoundException('Lead no encontrado');
    const lastFromClient = await this.chats.findOne({
      where: { lead: { id: leadId }, role: ChatRole.USER, channel: ChatChannel.WHATSAPP },
      order: { createdAt: 'DESC' },
    });
    const closesAt = lastFromClient ? new Date(lastFromClient.createdAt.getTime() + WINDOW_MS) : null;
    const open = closesAt !== null && closesAt.getTime() > Date.now();

    const lastTemplate = await this.chats
      .createQueryBuilder('c')
      .where('c.lead_id = :leadId', { leadId })
      .andWhere("c.extractedData ? 'template'") // la columna se llama "extractedData" (sin name en la entidad)
      .orderBy('c.createdAt', 'DESC')
      .getOne();
    const templatePending = !!lastTemplate && (!lastFromClient || lastTemplate.createdAt > lastFromClient.createdAt);

    return { open, closesAt: open ? closesAt : null, templateAvailable: !!this.reengageTemplate(), templatePending };
  }

  /** Manda la plantilla de reenganche para reabrir una conversación vieja. */
  async sendReengageTemplate(leadId: string, userId: string): Promise<ChatHistory> {
    const template = this.reengageTemplate();
    if (!template) {
      throw new UnprocessableEntityException('No hay plantilla configurada (WHATSAPP_REENGAGE_TEMPLATE). Creala y hacela aprobar en Meta Business.');
    }
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    if (!lead.phone) throw new UnprocessableEntityException('El lead no tiene teléfono cargado');

    const window = await this.windowStatus(leadId);
    if (window.open) throw new ConflictException('La conversación está abierta: escribile un mensaje normal.');
    if (window.templatePending) throw new ConflictException('Ya le mandaste la plantilla y todavía no contestó.');

    // {{1}} de la plantilla = nombre de pila; sin nombre queda "Hola de nuevo, ..."
    const firstName = lead.fullName?.trim().split(/\s+/)[0] || 'de nuevo';
    let wamid: string | undefined;
    try {
      wamid = await this.whatsapp.sendTemplate(lead.phone.replace(/^\+/, ''), template.name, template.language, [firstName]);
    } catch (err) {
      if (err instanceof WhatsAppSendError) throw new BadGatewayException(`WhatsApp no aceptó la plantilla: ${err.message}`);
      throw err;
    }

    const author = await this.users.findOne({ where: { id: userId } });
    const saved = await this.chats.save(
      this.chats.create({
        lead,
        channel: ChatChannel.WHATSAPP,
        role: ChatRole.AGENT,
        content: `Se envió la plantilla de WhatsApp "${template.name}" para retomar la conversación.`,
        authorName: author?.fullName ?? author?.email,
        externalMessageId: wamid,
        extractedData: { template: template.name },
      }),
    );
    // Cuando conteste, que lo atienda el asesor que lo buscó.
    lead.aiPaused = true;
    lead.lastInteractionAt = new Date();
    await this.leads.save(lead);
    return saved;
  }

  private reengageTemplate(): { name: string; language: string } | null {
    const name = this.config.get<string>('WHATSAPP_REENGAGE_TEMPLATE')?.trim();
    return name ? { name, language: this.config.get<string>('WHATSAPP_TEMPLATE_LANG')?.trim() || 'es_AR' } : null;
  }

  private nameOf(lead: Lead): string {
    return lead.fullName ?? lead.phone ?? 'Un cliente';
  }

  private async rescore(leadId: string): Promise<void> {
    try {
      await this.matching.scoreLead(leadId);
    } catch (err) {
      this.logger.warn(`No se pudo recalcular el puntaje de ${leadId}: ${(err as Error).message}`);
    }
  }

  /** Mensaje escrito por un asesor desde el CRM. Pausa al asistente para que no se pisen. */
  async sendAgentMessage(leadId: string, text: string, userId: string): Promise<ChatHistory> {
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    if (!lead.phone) throw new UnprocessableEntityException('El lead no tiene teléfono cargado');

    if (!(await this.windowStatus(leadId)).open) {
      throw new ConflictException(
        'WhatsApp solo deja escribir libremente hasta 24 h después del último mensaje del cliente. ' +
          'Para retomar la conversación mandale la plantilla de saludo; cuando conteste, se reabre la ventana.',
      );
    }

    let wamid: string | undefined;
    try {
      wamid = await this.whatsapp.sendText(lead.phone.replace(/^\+/, ''), text);
    } catch (err) {
      if (err instanceof WhatsAppSendError) throw new BadGatewayException(`WhatsApp no aceptó el mensaje: ${err.message}`);
      throw err;
    }

    const author = await this.users.findOne({ where: { id: userId } });
    const saved = await this.chats.save(
      this.chats.create({
        lead,
        channel: ChatChannel.WHATSAPP,
        role: ChatRole.AGENT,
        content: text,
        authorName: author?.fullName ?? author?.email,
        externalMessageId: wamid,
      }),
    );
    lead.aiPaused = true;
    lead.lastInteractionAt = new Date();
    await this.leads.save(lead);
    await this.notifications.markLeadRead(lead.id); // ya lo está atendiendo alguien
    return saved;
  }

  private async applyTool(lead: Lead, call: LlmToolCall) {
    if (call.name === 'update_lead_profile') {
      // Lo arma el modelo: puede traer tipos o valores inválidos. Lo que no tenga el formato esperado se ignora.
      const i = call.input ?? {};
      const fullName = typeof i.full_name === 'string' ? i.full_name.trim().slice(0, 100) : '';
      if (fullName.length >= 2) lead.fullName = fullName;
      if (Object.values(OperationType).includes(i.operation)) lead.wantsOperation = i.operation;
      const budget = toNumber(i.budget_max_usd);
      if (budget !== null && budget > 0 && budget < 1e12) lead.budgetMaxUsd = budget;
      if (Array.isArray(i.neighborhoods)) {
        const hoods = i.neighborhoods.filter((n: unknown): n is string => typeof n === 'string').map((n: string) => n.trim().slice(0, 80)).filter(Boolean);
        if (hoods.length) lead.preferredNeighborhoods = [...new Set([...(lead.preferredNeighborhoods ?? []), ...hoods])].slice(0, 20);
      }
      const rooms = toNumber(i.min_rooms);
      if (rooms !== null && Number.isInteger(rooms) && rooms >= 1 && rooms <= 20) lead.minRooms = rooms;
      if (typeof i.needs_garage === 'boolean') lead.needsGarage = i.needs_garage;
      const urgency = toNumber(i.urgency);
      if (urgency !== null) lead.urgency = Math.min(1, Math.max(0, urgency));
      await this.leads.save(lead);
    }
    if (call.name === 'handoff_to_agent') {
      lead.aiPaused = true;
      await this.leads.save(lead);
      await this.notifications.notify(
        NotificationType.CLIENTE_ESPERANDO,
        `${this.nameOf(lead)} necesita un asesor`,
        typeof call.input.reason === 'string' ? excerpt(call.input.reason) : undefined,
        lead.id,
      );
    }
    if (call.name === 'schedule_visit') {
      try {
        const visit = await this.visits.createFromAssistant(lead.id, call.input);
        lead.stage = (await this.leads.findOneByOrFail({ id: lead.id })).stage; // create() puede haberla avanzado
        this.logger.log(`Visita pendiente de confirmar: ${visit.id} (lead ${lead.id})`);
      } catch (err) {
        // El asistente ya respondió; se deja constancia en el chat para que un asesor lo resuelva.
        await this.chats.save(
          this.chats.create({
            lead,
            channel: ChatChannel.WHATSAPP,
            role: ChatRole.SYSTEM,
            content: `No se pudo agendar la visita que pidió el asistente: ${(err as Error).message}. Revisalo con el cliente.`,
            extractedData: { toolCall: call },
          }),
        );
      }
    }
  }
}
