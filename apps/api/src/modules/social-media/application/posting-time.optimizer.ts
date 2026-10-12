import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostStatus, SocialPlatform, SocialPost } from '../domain/social-post.entity';

/**
 * Elige el mejor horario de publicación por plataforma según engagement histórico.
 * Enfoque: promedio bayesiano por franja (día de semana x hora, zona Argentina) con
 * suavizado hacia la media global para franjas con pocos datos.
 */
@Injectable()
export class PostingTimeOptimizer {
  constructor(@InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>) {}

  async bestSlots(platform: SocialPlatform, top = 3): Promise<{ dow: number; hour: number; expectedEngagement: number }[]> {
    const rows = await this.posts
      .createQueryBuilder('s')
      .select("EXTRACT(DOW FROM s.published_at AT TIME ZONE 'America/Argentina/Buenos_Aires')", 'dow')
      .addSelect("EXTRACT(HOUR FROM s.published_at AT TIME ZONE 'America/Argentina/Buenos_Aires')", 'hour')
      .addSelect('AVG(s.engagement_rate)', 'avg')
      .addSelect('COUNT(*)', 'n')
      .where('s.platform = :platform AND s.status = :st', { platform, st: PostStatus.PUBLICADO })
      .groupBy('dow, hour')
      .getRawMany();

    if (!rows.length) return [{ dow: 2, hour: 20, expectedEngagement: 0 }]; // default: martes 20h
    const total = rows.reduce((a, r) => a + Number(r.n), 0);
    const globalAvg = rows.reduce((a, r) => a + Number(r.avg) * Number(r.n), 0) / total;
    const K = 5; // fuerza del prior

    return rows
      .map((r) => ({
        dow: Number(r.dow),
        hour: Number(r.hour),
        expectedEngagement: (Number(r.avg) * Number(r.n) + globalAvg * K) / (Number(r.n) + K),
      }))
      .sort((a, b) => b.expectedEngagement - a.expectedEngagement)
      .slice(0, top);
  }
}
