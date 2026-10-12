import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { PostMetrics, PublishResult, SocialPublisher } from '../domain/social-publisher.interface';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

@Injectable()
export class LinkedInPublisher implements SocialPublisher {
  readonly platform = SocialPlatform.LINKEDIN;
  private readonly version: string;

  constructor(private readonly http: HttpService, private readonly config: ConfigService) {
    this.version = config.get('LINKEDIN_API_VERSION', '202410'); // YYYYMM, actualizar según la doc vigente
  }

  /** urn:li:organization:123 o urn:li:person:abc */
  private get author() {
    return requiredSetting(this.config, 'LINKEDIN_AUTHOR_URN');
  }

  private get headers() {
    return {
      Authorization: `Bearer ${requiredSetting(this.config, 'LINKEDIN_ACCESS_TOKEN')}`,
      'Linkedin-Version': this.version,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('LINKEDIN_ACCESS_TOKEN')?.trim() && this.config.get<string>('LINKEDIN_AUTHOR_URN')?.trim());
  }

  async publish(post: SocialPost): Promise<PublishResult> {
    const body = {
      author: this.author,
      commentary: `${post.copy}\n\n${post.hashtags.slice(0, 3).map((h) => `#${h}`).join(' ')}`.trim(),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    const res = await firstValueFrom(this.http.post('https://api.linkedin.com/rest/posts', body, { headers: this.headers }));
    // LinkedIn devuelve el URN del post en el header x-restli-id
    return { externalId: String(res.headers['x-restli-id']), publishedAt: new Date() };
  }

  async fetchMetrics(externalId: string): Promise<PostMetrics> {
    const urn = encodeURIComponent(externalId);
    const res = await firstValueFrom(
      this.http.get(`https://api.linkedin.com/rest/socialActions/${urn}`, { headers: this.headers }),
    );
    return {
      views: 0, // impresiones: organizationalEntityShareStatistics (requiere permisos de organización)
      likes: res.data.likesSummary?.totalLikes ?? 0,
      comments: res.data.commentsSummary?.totalFirstLevelComments ?? 0,
      shares: 0,
      clicks: 0,
    };
  }
}
