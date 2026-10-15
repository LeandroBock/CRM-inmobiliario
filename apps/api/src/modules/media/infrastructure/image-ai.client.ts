import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

/** Una edición tarda unos segundos; más de esto es que Cloudflare está trabado. */
const TIMEOUT_MS = 90_000;

/**
 * Edición de fotos con IA en Cloudflare Workers AI (modelo FLUX.2 klein por defecto).
 * La cuenta gratis trae un cupo diario (10.000 "neuronas", unas 50–60 fotos) que se renueva a las 00:00 UTC.
 */
@Injectable()
export class ImageAiClient {
  private readonly logger = new Logger(ImageAiClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('CLOUDFLARE_ACCOUNT_ID')?.trim() && this.config.get<string>('CLOUDFLARE_AI_TOKEN')?.trim());
  }

  /** Devuelve la imagen generada (bytes). `input` tiene que ser chica: el modelo acepta hasta 512×512. */
  async edit(input: Buffer, prompt: string, width: number, height: number): Promise<Buffer> {
    const account = requiredSetting(this.config, 'CLOUDFLARE_ACCOUNT_ID').trim();
    const token = requiredSetting(this.config, 'CLOUDFLARE_AI_TOKEN').trim();
    const model = this.config.get<string>('IMAGE_AI_MODEL') || '@cf/black-forest-labs/flux-2-klein-4b';
    const base = (this.config.get<string>('CLOUDFLARE_API_URL') || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('input_image_0', new Blob([new Uint8Array(input)], { type: 'image/jpeg' }), 'foto.jpg');
    form.append('width', String(width));
    form.append('height', String(height));

    let res: Response;
    try {
      res = await fetch(`${base}/accounts/${encodeURIComponent(account)}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`Cloudflare no respondió: ${(err as Error).message}`);
      throw new ServiceUnavailableException('El servicio de IA de fotos no respondió. Probá de nuevo en un rato.');
    }

    // Puede devolver la imagen directo o un JSON { result: { image: base64 } }
    if (res.ok && res.headers.get('content-type')?.startsWith('image/')) return Buffer.from(await res.arrayBuffer());
    const body = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { code?: number; message?: string }[] } | null;
    if (res.ok && body?.result?.image) return Buffer.from(body.result.image, 'base64');

    const detail = body?.errors?.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') || `HTTP ${res.status}`;
    this.logger.error(`Cloudflare rechazó la edición: ${detail}`);
    if (res.status === 429 || /allocation|neuron|quota|limit/i.test(detail)) {
      throw new ServiceUnavailableException('Se terminó el cupo gratis de hoy de la IA de fotos. Se renueva todos los días a las 21 h (hora argentina).');
    }
    if (res.status === 401 || res.status === 403) {
      throw new ServiceUnavailableException('Cloudflare no aceptó la clave: revisá CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_AI_TOKEN (permiso "Workers AI").');
    }
    throw new ServiceUnavailableException(`La IA de fotos no pudo editar la imagen (${detail}).`);
  }
}
