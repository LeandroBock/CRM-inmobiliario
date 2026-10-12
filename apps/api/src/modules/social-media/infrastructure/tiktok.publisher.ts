import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { PostMetrics, PublishResult, SocialPublisher } from '../domain/social-publisher.interface';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

/**
 * TikTok Content Posting API. Importante: hasta que TikTok audite la app, los videos
 * se publican como privados. El dominio de la URL del video debe estar verificado.
 */
@Injectable()
export class TikTokPublisher implements SocialPublisher {
  readonly platform = SocialPlatform.TIKTOK;

  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  private get token() {
    return requiredSetting(this.config, 'TIKTOK_ACCESS_TOKEN');
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('TIKTOK_ACCESS_TOKEN')?.trim());
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const videoUrl = post.mediaUrls[0];
    if (!videoUrl) throw new Error('TikTok requiere un video (URL pública verificada)');

    const res = await firstValueFrom(
      this.http.post(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          post_info: {
            title: `${post.copy} ${post.hashtags.map((h) => `#${h}`).join(' ')}`.slice(0, 2200),
            privacy_level: 'SELF_ONLY', // cambiar a PUBLIC_TO_EVERYONE tras la auditoría
          },
          source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
        },
        { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json; charset=UTF-8' } },
      ),
    );
    return { externalId: res.data.data.publish_id, publishedAt: new Date() };
  }

  async fetchMetrics(): Promise<PostMetrics> {
    // Requiere el video_id final (se obtiene al consultar el estado del publish_id) y el scope video.list.
    return { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  }
}
