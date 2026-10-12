import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { PostStatus, SocialPost } from '../domain/social-post.entity';
import { SOCIAL_PUBLISHERS, SocialPublisher } from '../domain/social-publisher.interface';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
    @Inject(SOCIAL_PUBLISHERS) private readonly publishers: SocialPublisher[],
  ) {}

  /** Cada minuto publica lo que ya venció su horario programado. */
  @Cron(CronExpression.EVERY_MINUTE)
  async publishDue(): Promise<void> {
    const due = await this.posts.find({
      where: { status: PostStatus.PROGRAMADO, scheduledAt: LessThanOrEqual(new Date()) },
      take: 20,
    });
    for (const post of due) await this.publishOne(post);
  }

  async publishOne(post: SocialPost): Promise<SocialPost> {
    const publisher = this.publishers.find((p) => p.platform === post.platform);
    if (!publisher) {
      post.status = PostStatus.FALLIDO;
      post.errorMessage = `No hay publisher configurado para ${post.platform}`;
      return this.posts.save(post);
    }
    try {
      const result = await publisher.publish(post);
      post.status = PostStatus.PUBLICADO;
      post.externalId = result.externalId;
      post.publishedAt = result.publishedAt;
      post.errorMessage = undefined;
    } catch (err: any) {
      this.logger.error(`Falló la publicación ${post.id} en ${post.platform}: ${err?.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      post.status = PostStatus.FALLIDO;
      post.errorMessage = String(err?.message ?? err).slice(0, 500);
    }
    return this.posts.save(post);
  }

  /** Cada hora refresca métricas de posts de los últimos 14 días. */
  @Cron(CronExpression.EVERY_HOUR)
  async refreshMetrics(): Promise<void> {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const posts = await this.posts.find({
      where: { status: PostStatus.PUBLICADO, externalId: Not(IsNull()) },
      order: { publishedAt: 'DESC' },
      take: 200,
    });
    for (const post of posts.filter((p) => p.publishedAt && p.publishedAt >= since)) {
      const publisher = this.publishers.find((p) => p.platform === post.platform);
      if (!publisher || !post.externalId) continue;
      try {
        const m = await publisher.fetchMetrics(post.externalId);
        Object.assign(post, m);
        post.engagementRate = m.views > 0 ? (m.likes + m.comments + m.shares + m.clicks) / m.views : 0;
        post.metricsUpdatedAt = new Date();
        await this.posts.save(post);
      } catch (err: any) {
        this.logger.warn(`Métricas no disponibles para ${post.id}: ${err.message}`);
      }
    }
  }
}
