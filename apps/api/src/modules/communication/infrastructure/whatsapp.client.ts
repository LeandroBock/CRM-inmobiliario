import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { graphBase } from '../../../shared/infrastructure/meta-graph';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

/** Cliente de WhatsApp Business Cloud API (Meta). Para Twilio, implementar la misma interfaz. */
export class WhatsAppSendError extends Error {}

@Injectable()
export class WhatsAppClient {
  private readonly logger = new Logger(WhatsAppClient.name);

  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  private get url() {
    return `${graphBase(this.config)}/${requiredSetting(this.config, 'WHATSAPP_PHONE_NUMBER_ID')}/messages`;
  }
  private get token() {
    return requiredSetting(this.config, 'WHATSAPP_TOKEN');
  }

  /** Devuelve el wamid del mensaje enviado. */
  sendText(to: string, body: string): Promise<string | undefined> {
    return this.send(to, { type: 'text', text: { body, preview_url: false } });
  }

  /**
   * Plantilla aprobada por Meta: lo único que se puede mandar pasadas 24 h del último mensaje del cliente.
   * `params` reemplaza las variables {{1}}, {{2}}... del cuerpo, en orden.
   */
  sendTemplate(to: string, name: string, language: string, params: string[]): Promise<string | undefined> {
    const components = params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [];
    return this.send(to, { type: 'template', template: { name, language: { code: language }, components } });
  }

  private async send(to: string, message: Record<string, unknown>): Promise<string | undefined> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ messages?: { id: string }[] }>(
          this.url,
          { messaging_product: 'whatsapp', to, ...message },
          { headers: { Authorization: `Bearer ${this.token}` } },
        ),
      );
      return res.data.messages?.[0]?.id;
    } catch (err: any) {
      // Meta explica el motivo en error.message (token vencido, número inválido, fuera de la ventana de 24 h...)
      const reason = err?.response?.data?.error?.message ?? (err as Error).message;
      this.logger.error(`No se pudo enviar el mensaje a ${to}: ${reason}`);
      throw new WhatsAppSendError(reason);
    }
  }

  /**
   * Descarga un archivo recibido (audio, foto). Meta da primero una URL temporal (5 min) y después
   * hay que bajarla con el mismo token. Rechaza archivos más grandes que `maxBytes`.
   */
  async downloadMedia(mediaId: string, maxBytes: number): Promise<{ data: Buffer; mimeType: string }> {
    const headers = { Authorization: `Bearer ${this.token}` };
    const meta = await firstValueFrom(
      this.http.get<{ url: string; mime_type: string; file_size?: number }>(`${graphBase(this.config)}/${encodeURIComponent(mediaId)}`, { headers }),
    );
    if (meta.data.file_size && meta.data.file_size > maxBytes) {
      throw new Error(`Archivo demasiado grande (${meta.data.file_size} bytes)`);
    }
    const file = await firstValueFrom(
      this.http.get<ArrayBuffer>(meta.data.url, { headers, responseType: 'arraybuffer', maxContentLength: maxBytes }),
    );
    return { data: Buffer.from(file.data), mimeType: meta.data.mime_type };
  }

  /** Best effort: si falla (o falta configuración), el mensaje simplemente no aparece como leído. */
  async markAsRead(messageId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          this.url,
          { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
          { headers: { Authorization: `Bearer ${this.token}` } },
        ),
      );
    } catch {
      // sin consecuencias
    }
  }
}
