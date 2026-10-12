import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
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
    await this.recoverStuck();
    const due = await this.posts.find({
      where: { status: PostStatus.PROGRAMADO, scheduledAt: LessThanOrEqual(new Date()) },
      take: 20,
    });
    for (const post of due) {
      await this.publishOne(post).catch((err) => {
        if (!(err instanceof ConflictException)) this.logger.error(`Publicación programada ${post.id}: ${(err as Error).message}`);
      });
    }
  }

  /**
   * Publica ya. Antes "toma" la publicación (estado publicando) con una sola actualización en la base: si dos pedidos
   * llegan juntos (doble clic, o el programador al mismo tiempo), solo uno publica.
   */
  async publishOne(post: SocialPost): Promise<SocialPost> {
    const claimed = await this.posts
      .createQueryBuilder()
      .update()
      .set({ status: PostStatus.PUBLICANDO, errorMessage: () => 'NULL' })
      .where('id = :id AND status IN (:...ready)', { id: post.id, ready: [PostStatus.BORRADOR, PostStatus.PROGRAMADO, PostStatus.FALLIDO] })
      .execute();
    if (!claimed.affected) throw new ConflictException('Esta publicación ya se publicó o se está publicando');

    const publisher = this.publishers.find((p) => p.platform === post.platform);
    try {
      if (!publisher?.isConfigured()) throw new Error(`Falta configurar ${post.platform} (claves de Meta en el servidor)`);
      const result = await publisher.publish(post);
      await this.posts.update(post.id, {
        status: PostStatus.PUBLICADO,
        externalId: result.externalId,
        externalUrl: result.url ?? null,
        publishedAt: result.publishedAt,
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.logger.error(`Falló la publicación ${post.id} en ${post.platform}: ${message}`);
      await this.posts.update(post.id, { status: PostStatus.FALLIDO, errorMessage: message.slice(0, 500) });
    }
    return this.posts.findOneOrFail({ where: { id: post.id }, relations: { property: true } });
  }

  /**
   * Si la API se reinició en medio de una publicación, quedó en "publicando". A los 10 minutos se marca como fallida,
   * sin reintentar sola: puede haber salido igual, así que conviene mirar la red antes de volver a publicar.
   */
  private async recoverStuck(): Promise<void> {
    await this.posts
      .createQueryBuilder()
      .update()
      .set({ status: PostStatus.FALLIDO, errorMessage: 'Se cortó mientras se publicaba. Fijate en la red si salió antes de volver a publicar.' })
      .where("status = :s AND updated_at < now() - interval '10 minutes'", { s: PostStatus.PUBLICANDO })
      .execute();
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
