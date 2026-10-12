import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { graphBase, graphErrorMessage } from '../../../shared/infrastructure/meta-graph';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';
import { SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { PostMetrics, PublishResult, SocialPublisher } from '../domain/social-publisher.interface';

/** Instagram y Facebook aceptan hasta 10 fotos por posteo (carrusel). */
export const MAX_PHOTOS_PER_POST = 10;

/** Texto final: el copy y los hashtags al final. */
export function captionOf(p: Pick<SocialPost, 'copy' | 'hashtags'>): string {
  const tags = (p.hashtags ?? []).map((h) => `#${h}`).join(' ');
  return [p.copy?.trim(), tags].filter(Boolean).join('\n\n');
}

/**
 * Pedidos a la Graph API con el token de la página (META_ACCESS_TOKEN). Se mandan como formulario (no en la URL:
 * un texto largo no entra) y los errores de Meta se convierten en un mensaje que se entiende.
 */
export abstract class MetaGraphClient {
  /** Token de la página y cuenta de Instagram, obtenidos una vez y guardados en memoria. */
  private static pageToken?: { base: string; token: string };
  private static igAccount?: { page: string; id: string };

  constructor(
    protected readonly http: HttpService,
    protected readonly config: ConfigService,
  ) {}

  /**
   * Para publicar como página, Meta pide el token *de la página*. META_ACCESS_TOKEN puede ser ese, o el token
   * permanente de un usuario del sistema de Meta Business con la página asignada: en ese caso se pide el de la página.
   */
  protected async token(): Promise<string> {
    const base = requiredSetting(this.config, 'META_ACCESS_TOKEN');
    const pageId = this.config.get<string>('META_PAGE_ID')?.trim();
    if (!pageId) return base;
    if (MetaGraphClient.pageToken?.base === base) return MetaGraphClient.pageToken.token;
    let token = base;
    try {
      const res = await firstValueFrom(this.http.get<{ access_token?: string }>(`${graphBase(this.config)}/${pageId}`, { params: { fields: 'access_token', access_token: base } }));
      token = res.data.access_token || base;
    } catch {
      // ya es un token de página (o no tiene permiso para pedirlo): se usa tal cual
    }
    MetaGraphClient.pageToken = { base, token };
    return token;
  }

  /** Cuenta de Instagram vinculada a la página (META_IG_USER_ID, o se busca sola a partir de META_PAGE_ID). */
  protected async instagramAccount(): Promise<string> {
    const configured = this.config.get<string>('META_IG_USER_ID')?.trim();
    if (configured) return configured;
    const pageId = requiredSetting(this.config, 'META_PAGE_ID');
    if (MetaGraphClient.igAccount?.page === pageId) return MetaGraphClient.igAccount.id;
    const res = await this.get<{ instagram_business_account?: { id: string } }>(pageId, { fields: 'instagram_business_account' });
    const id = res.instagram_business_account?.id;
    if (!id) throw new Error('La página de Facebook no tiene una cuenta de Instagram profesional vinculada');
    MetaGraphClient.igAccount = { page: pageId, id };
    return id;
  }

  /** Para los tests: olvida el token y la cuenta guardados. */
  static forgetCache(): void {
    MetaGraphClient.pageToken = undefined;
    MetaGraphClient.igAccount = undefined;
  }

  protected async post<T>(path: string, params: Record<string, string>): Promise<T> {
    try {
      const body = new URLSearchParams({ ...params, access_token: await this.token() });
      return (await firstValueFrom(this.http.post<T>(`${graphBase(this.config)}/${path}`, body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }))).data;
    } catch (err) {
      throw new Error(graphErrorMessage(err));
    }
  }

  protected async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    try {
      return (await firstValueFrom(this.http.get<T>(`${graphBase(this.config)}/${path}`, { params: { ...params, access_token: await this.token() } }))).data;
    } catch (err) {
      throw new Error(graphErrorMessage(err));
    }
  }
}

/** Instagram (cuenta profesional vinculada a la página de Facebook): una foto o carrusel de hasta 10. */
@Injectable()
export class InstagramPublisher extends MetaGraphClient implements SocialPublisher {
  readonly platform = SocialPlatform.INSTAGRAM;
  /** Cuánto se espera a que Instagram termine de procesar las fotos antes de publicar. */
  protected readyPollMs = 2000;
  protected readyAttempts = 15;

  constructor(http: HttpService, config: ConfigService) {
    super(http, config);
  }

  isConfigured(): boolean {
    const id = this.config.get<string>('META_IG_USER_ID')?.trim() || this.config.get<string>('META_PAGE_ID')?.trim();
    return Boolean(this.config.get<string>('META_ACCESS_TOKEN')?.trim() && id);
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const photos = post.mediaUrls ?? [];
    if (!photos.length) throw new Error('Instagram necesita al menos una foto');
    if (photos.length > MAX_PHOTOS_PER_POST) throw new Error(`Instagram acepta hasta ${MAX_PHOTOS_PER_POST} fotos`);
    const caption = captionOf(post);
    const ig = await this.instagramAccount();

    // 1) "Contenedor" con las fotos. En carrusel, primero uno por foto y después el que las agrupa.
    let containerId: string;
    if (photos.length === 1) {
      containerId = (await this.post<{ id: string }>(`${ig}/media`, { image_url: photos[0], caption })).id;
    } else {
      const children: string[] = [];
      for (const url of photos) {
        children.push((await this.post<{ id: string }>(`${ig}/media`, { image_url: url, is_carousel_item: 'true' })).id);
      }
      for (const id of children) await this.waitReady(id);
      containerId = (await this.post<{ id: string }>(`${ig}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption })).id;
    }
    await this.waitReady(containerId);

    // 2) Publicar y pedir el link
    const { id } = await this.post<{ id: string }>(`${ig}/media_publish`, { creation_id: containerId });
    const url = await this.get<{ permalink?: string }>(id, { fields: 'permalink' })
      .then((r) => r.permalink ?? null)
      .catch(() => null);
    return { externalId: id, publishedAt: new Date(), url };
  }

  /** Instagram baja y procesa cada foto: hay que esperar a que el contenedor esté FINISHED. */
  private async waitReady(containerId: string): Promise<void> {
    for (let i = 0; i < this.readyAttempts; i++) {
      const { status_code, status } = await this.get<{ status_code?: string; status?: string }>(containerId, { fields: 'status_code,status' });
      if (!status_code || status_code === 'FINISHED' || status_code === 'PUBLISHED') return;
      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`Instagram no pudo procesar la foto${status ? ` (${status})` : ''}. Las fotos tienen que ser JPG y tener un link público.`);
      }
      await new Promise((r) => setTimeout(r, this.readyPollMs));
    }
    throw new Error('Instagram tardó demasiado en procesar las fotos. Probá de nuevo en unos minutos.');
  }

  async fetchMetrics(externalId: string): Promise<PostMetrics> {
    const res = await this.get<{ data?: { name: string; values?: { value: number }[] }[] }>(`${externalId}/insights`, {
      metric: 'views,likes,comments,shares,total_interactions',
    });
    const m: Record<string, number> = {};
    for (const row of res.data ?? []) m[row.name] = row.values?.[0]?.value ?? 0;
    return { views: m.views ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0, shares: m.shares ?? 0, clicks: 0 };
  }
}

/** Página de Facebook: texto, una foto o varias fotos en un mismo posteo. */
@Injectable()
export class FacebookPublisher extends MetaGraphClient implements SocialPublisher {
  readonly platform = SocialPlatform.FACEBOOK;

  constructor(http: HttpService, config: ConfigService) {
    super(http, config);
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('META_ACCESS_TOKEN')?.trim() && this.config.get<string>('META_PAGE_ID')?.trim());
  }

  private get pageId() {
    return requiredSetting(this.config, 'META_PAGE_ID');
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const photos = post.mediaUrls ?? [];
    if (photos.length > MAX_PHOTOS_PER_POST) throw new Error(`Hasta ${MAX_PHOTOS_PER_POST} fotos por publicación`);
    const message = captionOf(post);
    if (!message && !photos.length) throw new Error('La publicación está vacía');

    let postId: string;
    if (photos.length === 0) {
      postId = (await this.post<{ id: string }>(`${this.pageId}/feed`, { message })).id;
    } else if (photos.length === 1) {
      const r = await this.post<{ id: string; post_id?: string }>(`${this.pageId}/photos`, { url: photos[0], caption: message });
      postId = r.post_id ?? r.id;
    } else {
      // Varias fotos: se suben sin publicar y después se publica un posteo que las incluye.
      const attached: Record<string, string> = {};
      for (const [i, url] of photos.entries()) {
        const { id } = await this.post<{ id: string }>(`${this.pageId}/photos`, { url, published: 'false' });
        attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
      }
      postId = (await this.post<{ id: string }>(`${this.pageId}/feed`, { message, ...attached })).id;
    }
    const url = await this.get<{ permalink_url?: string }>(postId, { fields: 'permalink_url' })
      .then((r) => r.permalink_url ?? null)
      .catch(() => null);
    return { externalId: postId, publishedAt: new Date(), url };
  }

  async fetchMetrics(externalId: string): Promise<PostMetrics> {
    const d = await this.get<{ shares?: { count: number }; comments?: { summary?: { total_count: number } }; reactions?: { summary?: { total_count: number } } }>(
      externalId,
      { fields: 'shares,comments.summary(true),reactions.summary(true)' },
    );
    return {
      views: 0, // las impresiones requieren el endpoint /insights de la Página
      likes: d.reactions?.summary?.total_count ?? 0,
      comments: d.comments?.summary?.total_count ?? 0,
      shares: d.shares?.count ?? 0,
      clicks: 0,
    };
  }
}
