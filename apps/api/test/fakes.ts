import type { LlmMessage, LlmReply } from '../src/modules/communication/infrastructure/llm.client';
import { WhatsAppSendError } from '../src/modules/communication/infrastructure/whatsapp.client';

/** Claude simulado: devuelve las respuestas encoladas y guarda lo que recibió. */
export class FakeLlm {
  calls: { system: string; history: LlmMessage[] }[] = [];
  /** false = como si no hubiera ANTHROPIC_API_KEY (asistente apagado). */
  configured = true;

  isConfigured() {
    return this.configured;
  }
  private queue: (LlmReply | Error)[] = [];

  /** Próximas respuestas, en orden. Sin respuestas encoladas contesta "Respuesta de prueba". */
  willReply(...replies: (Partial<LlmReply> | Error)[]) {
    this.queue.push(...replies.map((r) => (r instanceof Error ? r : { text: '', toolCalls: [], ...r })));
  }

  async reply(system: string, history: LlmMessage[]): Promise<LlmReply> {
    this.calls.push({ system, history: structuredClone(history) });
    const next = this.queue.shift() ?? { text: 'Respuesta de prueba', toolCalls: [] };
    if (next instanceof Error) throw next;
    return next;
  }

  reset() {
    this.calls = [];
    this.queue = [];
    this.configured = true;
  }
}

/** WhatsApp simulado: registra lo enviado y entrega los archivos que se le carguen. */
export class FakeWhatsApp {
  sent: { to: string; text: string }[] = [];
  templates: { to: string; name: string; language: string; params: string[] }[] = [];
  read: string[] = [];
  media = new Map<string, { data: Buffer; mimeType: string }>();
  failSending = false;
  private seq = 0;

  async sendText(to: string, text: string) {
    if (this.failSending) throw new WhatsAppSendError('(#131047) Re-engagement message');
    this.sent.push({ to, text });
    return `wamid.enviado.${++this.seq}`;
  }

  async sendTemplate(to: string, name: string, language: string, params: string[]) {
    if (this.failSending) throw new WhatsAppSendError('Template name does not exist');
    this.templates.push({ to, name, language, params });
    return `wamid.plantilla.${++this.seq}`;
  }

  async downloadMedia(mediaId: string) {
    const file = this.media.get(mediaId);
    if (!file) throw new Error(`media ${mediaId} no encontrado`);
    return file;
  }

  documents: { to: string; mediaId: string; filename: string; caption?: string }[] = [];
  uploads: { mediaId: string; data: Buffer; mimeType: string; filename: string }[] = [];

  async uploadMedia(data: Buffer, mimeType: string, filename: string) {
    if (this.failSending) throw new WhatsAppSendError('(#100) Invalid parameter');
    const mediaId = `media.${++this.seq}`;
    this.uploads.push({ mediaId, data, mimeType, filename });
    return mediaId;
  }

  async sendDocument(to: string, mediaId: string, filename: string, caption?: string) {
    this.documents.push({ to, mediaId, filename, caption });
    return `wamid.documento.${++this.seq}`;
  }

  async markAsRead(wamid: string) {
    this.read.push(wamid);
  }

  reset() {
    this.sent = [];
    this.templates = [];
    this.read = [];
    this.documents = [];
    this.uploads = [];
    this.media.clear();
    this.failSending = false;
  }
}

/** Whisper simulado: devuelve el texto configurado (null = no se pudo transcribir). */
export class FakeTranscriber {
  result: string | null = null;
  async transcribe() {
    return this.result;
  }
}
