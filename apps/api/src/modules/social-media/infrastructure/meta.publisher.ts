import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PostFormat, SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { PostMetrics, PublishResult, SocialPublisher } from '../domain/social-publisher.interface';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Instagram (Graph API, cuenta Business) */
@Injectable()
export class InstagramPublisher implements SocialPublisher {
  readonly platform = SocialPlatform.INSTAGRAM;

  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  private get igUserId() {
    return requiredSetting(this.config, 'META_IG_USER_ID');
  }
  private get token() {
    return requiredSetting(this.config, 'META_ACCESS_TOKEN');
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const caption = this.caption(post);
    const media = post.mediaUrls[0];
    if (!media) throw new Error('Instagram requiere al menos una imagen o video (URL pública)');

    // 1) Crear el contenedor de media
    const params: Record<string, string> = { caption, access_token: this.token };
    if (post.format === PostFormat.REEL || post.format === PostFormat.VIDEO) {
      params.media_type = 'REELS';
      params.video_url = media;
    } else {
      params.image_url = media;
    }
    const created = await firstValueFrom(this.http.post(`${GRAPH}/${this.igUserId}/media`, null, { params }));

    // 2) Publicar (para videos hay que esperar a que el contenedor esté FINISHED; ver status_code)
    const published = await firstValueFrom(
      this.http.post(`${GRAPH}/${this.igUserId}/media_publish`, null, {
        params: { creation_id: created.data.id, access_token: this.token },
      }),
    );
    return { externalId: published.data.id, publishedAt: new Date() };
  }

  async fetchMetrics(externalId: string): Promise<PostMetrics> {
    // Los nombres de métricas cambian entre versiones de la Graph API: validar contra la versión en uso.
    const res = await firstValueFrom(
      this.http.get(`${GRAPH}/${externalId}/insights`, {
        params: { metric: 'views,likes,comments,shares,total_interactions', access_token: this.token },
      }),
    );
    const m: Record<string, number> = {};
    for (const row of res.data.data ?? []) m[row.name] = row.values?.[0]?.value ?? 0;
    return { views: m.views ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0, shares: m.shares ?? 0, clicks: 0 };
  }

  private caption(p: SocialPost) {
    return `${p.copy}\n\n${p.hashtags.map((h) => `#${h}`).join(' ')}`.trim();
  }
}

/** Facebook (Página) */
@Injectable()
export class FacebookPublisher implements SocialPublisher {
  readonly platform = SocialPlatform.FACEBOOK;

  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  private get pageId() {
    return requiredSetting(this.config, 'META_PAGE_ID');
  }
  private get token() {
    return requiredSetting(this.config, 'META_ACCESS_TOKEN');
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const image = post.mediaUrls[0];
    const res = image
      ? await firstValueFrom(
          this.http.post(`${GRAPH}/${this.pageId}/photos`, null, {
            params: { url: image, caption: post.copy, access_token: this.token },
          }),
        )
      : await firstValueFrom(
          this.http.post(`${GRAPH}/${this.pageId}/feed`, null, { params: { message: post.copy, access_token: this.token } }),
        );
    return { externalId: res.data.post_id ?? res.data.id, publishedAt: new Date() };
  }

  async fetchMetrics(externalId: string): Promise<PostMetrics> {
    const res = await firstValueFrom(
      this.http.get(`${GRAPH}/${externalId}`, {
        params: { fields: 'shares,comments.summary(true),reactions.summary(true)', access_token: this.token },
      }),
    );
    const d = res.data;
    return {
      views: 0, // las impresiones requieren el endpoint /insights de la Página
      likes: d.reactions?.summary?.total_count ?? 0,
      comments: d.comments?.summary?.total_count ?? 0,
      shares: d.shares?.count ?? 0,
      clicks: 0,
    };
  }
}
