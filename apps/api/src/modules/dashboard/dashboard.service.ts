import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStage } from '../leads/domain/lead.entity';
import { MatchScore } from '../lead-engine/domain/match-score.entity';
import { PostingTimeOptimizer } from '../social-media/application/posting-time.optimizer';
import { PostStatus, SocialPlatform, SocialPost } from '../social-media/domain/social-post.entity';

const FUNNEL: LeadStage[] = [
  LeadStage.NUEVO,
  LeadStage.CALIFICADO,
  LeadStage.VISITA_AGENDADA,
  LeadStage.NEGOCIACION,
  LeadStage.CERRADO,
];
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(MatchScore) private readonly matches: Repository<MatchScore>,
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
    private readonly optimizer: PostingTimeOptimizer,
  ) {}

  async getOverview() {
    const [funnel, hotLeads, posts, bestSlots] = await Promise.all([
      this.funnel(),
      this.hotLeads(),
      this.recentPosts(),
      this.bestSlots(),
    ]);
    return { funnel, hotLeads, posts, bestSlots };
  }

  /** Embudo acumulado: cada paso cuenta los leads que llegaron a esa etapa o a una posterior (excluye perdidos). */
  private async funnel() {
    const rows = await this.leads
      .createQueryBuilder('l')
      .select('l.stage', 'stage')
      .addSelect('COUNT(*)', 'count')
      .where("l.stage <> 'perdido'")
      .groupBy('l.stage')
      .getRawMany<{ stage: LeadStage; count: string }>();
    const byStage = new Map(rows.map((r) => [r.stage, Number(r.count)]));
    return FUNNEL.map((stage, i) => ({
      stage,
      count: FUNNEL.slice(i).reduce((acc, s) => acc + (byStage.get(s) ?? 0), 0),
    }));
  }

  private async hotLeads() {
    const leads = await this.leads.find({ order: { leadScore: 'DESC' }, take: 5 });
    return Promise.all(
      leads.map(async (l) => {
        const top = await this.matches.findOne({ where: { lead: { id: l.id } }, relations: ['property'], order: { score: 'DESC' } });
        return { id: l.id, fullName: l.fullName ?? l.phone ?? 'Sin nombre', leadScore: l.leadScore, topMatch: top?.property.title };
      }),
    );
  }

  private recentPosts() {
    return this.posts.find({ where: { status: PostStatus.PUBLICADO }, order: { publishedAt: 'DESC' }, take: 8 }).then((rows) =>
      rows.map((p) => ({
        id: p.id,
        platform: p.platform,
        copy: p.copy.length > 80 ? `${p.copy.slice(0, 77)}…` : p.copy,
        views: p.views,
        engagementRate: p.engagementRate,
        clicks: p.clicks,
        publishedAt: p.publishedAt,
      })),
    );
  }

  private async bestSlots() {
    const platforms = Object.values(SocialPlatform);
    const results = await Promise.all(platforms.map((pl) => this.optimizer.bestSlots(pl, 1)));
    return results.map(([slot], i) => ({
      platform: PLATFORM_LABEL[platforms[i]],
      label: `${DAYS[slot.dow]} ${String(slot.hour).padStart(2, '0')}:00`,
    }));
  }
}
