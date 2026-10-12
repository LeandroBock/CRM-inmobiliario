import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pasa una nota de voz a texto. La API de Claude no recibe audio, así que se usa un servicio aparte;
 * hoy OpenAI (Whisper). Para cambiar de proveedor alcanza con otra implementación de este servicio.
 */
@Injectable()
export class AudioTranscriber {
  private readonly logger = new Logger(AudioTranscriber.name);
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('OPENAI_API_KEY') || undefined;
    this.model = config.get<string>('TRANSCRIBE_MODEL') || 'whisper-1';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Devuelve el texto, o null si no hay servicio configurado o falló (el caller decide qué responder). */
  async transcribe(audio: Buffer, mimeType: string, fileName: string): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType.split(';')[0] }), fileName);
      form.append('model', this.model);
      form.append('language', 'es'); // mejora la precisión con el español rioplatense
      form.append('response_format', 'json');
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json()) as { text?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      const text = body.text?.trim();
      return text ? text : null;
    } catch (err) {
      this.logger.error(`No se pudo transcribir el audio: ${(err as Error).message}`);
      return null;
    }
  }
}
