import { Inject, Injectable } from '@nestjs/common';
import { VIDEO_CONTENT_TYPE, VIDEO_STORAGE, VideoStorage } from '../../media/domain/video-storage.port';
import { SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { PostMetrics, PublishResult, SocialPublisher } from '../domain/social-publisher.interface';
import { captionOf } from './meta.publisher';
import { TikTokApiError, TikTokAuthService } from './tiktok/tiktok-auth.service';

/** TikTok pide partes de 5 a 64 MB; los videos de menos de 5 MB van enteros. */
const MIN_CHUNK = 5 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

/** Plan de subida por partes: la última absorbe el resto (TikTok lo acepta hasta 128 MB). */
export function chunkPlan(size: number): { chunkSize: number; total: number; ranges: [number, number][] } {
  if (size < MIN_CHUNK) return { chunkSize: size, total: 1, ranges: [[0, size - 1]] };
  const total = Math.floor(size / CHUNK);
  const ranges: [number, number][] = [];
  for (let i = 0; i < total; i++) ranges.push([i * CHUNK, i === total - 1 ? size - 1 : (i + 1) * CHUNK - 1]);
  return { chunkSize: CHUNK, total, ranges };
}

/**
 * TikTok Content Posting API (Direct Post, FILE_UPLOAD): el video se sube desde el almacenamiento del CRM por partes.
 * Mientras TikTok no audite la app, solo se puede publicar en cuentas privadas (lo explica el error).
 */
@Injectable()
export class TikTokPublisher implements SocialPublisher {
  readonly platform = SocialPlatform.TIKTOK;
  /** Espera entre consultas de estado (TikTok descarga y procesa el video). */
  protected statusPollMs = 5000;
  protected statusAttempts = 60;

  constructor(
    private readonly auth: TikTokAuthService,
    @Inject(VIDEO_STORAGE) private readonly videos: VideoStorage,
  ) {}

  isConfigured(): boolean {
    return this.auth.isConfigured();
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const url = post.mediaUrls[0];
    const fileName = url ? this.videos.fileNameFromUrl(url) : null;
    if (!fileName) throw new Error('TikTok necesita un video subido al CRM');
    const size = await this.videos.size(fileName);
    if (!size) throw new Error('El video ya no está en el almacenamiento: volvé a subirlo');
    const options = post.platformOptions ?? {};
    if (!options.privacyLevel) throw new Error('Elegí la privacidad de la publicación de TikTok');

    const token = await this.auth.accessToken();
    const plan = chunkPlan(size);
    // 1) Iniciar: TikTok devuelve un publish_id y la dirección a la que subir el video
    const init = await this.auth.call<{ publish_id: string; upload_url: string }>('POST', '/v2/post/publish/video/init/', token, {
      post_info: {
        title: captionOf(post).slice(0, 2200),
        privacy_level: options.privacyLevel,
        disable_comment: Boolean(options.disableComment),
        disable_duet: Boolean(options.disableDuet),
        disable_stitch: Boolean(options.disableStitch),
      },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.total },
    });

    // 2) Subir por partes, leyendo cada tramo del almacenamiento (el video nunca se carga entero en memoria)
    const contentType = VIDEO_CONTENT_TYPE[fileName.split('.').pop()!];
    for (const [start, end] of plan.ranges) {
      const chunk = await this.videos.readRange(fileName, start, end);
      const res = await fetch(init.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
        body: chunk,
      });
      if (!res.ok) throw new Error(`TikTok no aceptó una parte del video (HTTP ${res.status})`);
    }

    // 3) Esperar a que TikTok lo procese y lo publique
    for (let i = 0; i < this.statusAttempts; i++) {
      const s = await this.auth.call<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
        'POST',
        '/v2/post/publish/status/fetch/',
        token,
        { publish_id: init.publish_id },
      );
      if (s.status === 'PUBLISH_COMPLETE') {
        const id = s.publicaly_available_post_id?.[0];
        const account = await this.auth.account();
        return {
          externalId: init.publish_id,
          publishedAt: new Date(),
          // Las privadas no tienen link público
          url: id && account?.username ? `https://www.tiktok.com/@${account.username}/video/${id}` : null,
        };
      }
      if (s.status === 'FAILED') throw new TikTokApiError(s.fail_reason ?? 'failed', `TikTok no pudo publicar el video (${s.fail_reason ?? 'sin motivo'})`);
      await new Promise((r) => setTimeout(r, this.statusPollMs));
    }
    throw new Error('TikTok sigue procesando el video. Revisá en la app de TikTok si salió antes de reintentar.');
  }

  async fetchMetrics(): Promise<PostMetrics> {
    // Requiere el id final del video y el permiso video.list (no se pide por ahora).
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }
}
