import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadTemperature } from '../../leads/domain/lead.entity';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationType } from '../../notifications/domain/notification.entity';
import { Property, PropertyStatus } from '../../properties/domain/property.entity';
import { MatchFeedback, MatchScore } from '../domain/match-score.entity';

/** Pesos del puntaje de afinidad (suman 1). Ajustables con feedback real (me_gusta / visitó). */
const W = { budget: 0.35, zone: 0.25, type: 0.15, rooms: 0.1, garage: 0.05, operation: 0.1 };

@Injectable()
export class MatchingService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(MatchScore) private readonly matches: Repository<MatchScore>,
    private readonly notifications: NotificationsService,
  ) {}

  /** Calcula y guarda el top-N de propiedades para un lead ("Tinder" inmobiliario). */
  async matchLead(leadId: string, topN = 5): Promise<MatchScore[]> {
    const lead = await this.leads.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const candidates = await this.properties.find({ where: { status: PropertyStatus.DISPONIBLE } });

    const scored = candidates
      .map((p) => ({ property: p, ...this.score(lead, p) }))
      .filter((s) => s.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    // Los matches sin respuesta del lead que ya no entran al top (se vendió, cambió el perfil...) se descartan.
    // Los que tienen feedback se conservan: son historial y sirven para reajustar los pesos.
    const stale = this.matches
      .createQueryBuilder()
      .delete()
      .where('lead_id = :leadId AND feedback = :pending', { leadId: lead.id, pending: MatchFeedback.PENDIENTE });
    if (scored.length) stale.andWhere('property_id NOT IN (:...keep)', { keep: scored.map((s) => s.property.id) });
    await stale.execute();

    if (scored.length) {
      await this.matches.upsert(
        scored.map((s) => ({ lead: { id: lead.id }, property: { id: s.property.id }, score: s.score, breakdown: s.breakdown })),
        ['lead', 'property'],
      );
    }
    return this.findForLead(lead.id);
  }

  /** Matches guardados del lead (sin recalcular), mejor puntaje primero. */
  async findForLead(leadId: string): Promise<MatchScore[]> {
    if (!(await this.leads.exists({ where: { id: leadId } }))) throw new NotFoundException('Lead no encontrado');
    return this.matches.find({ where: { lead: { id: leadId } }, relations: ['property'], order: { score: 'DESC' } });
  }

  score(lead: Lead, p: Property): { score: number; breakdown: Record<string, number> } {
    const b: Record<string, number> = {
      budget: this.budgetFit(lead, p.priceUsd),
      zone: lead.preferredNeighborhoods.length
        ? lead.preferredNeighborhoods.map((n) => n.toLowerCase()).includes(p.neighborhood.toLowerCase()) ? 1 : 0
        : 0.5,
      type: lead.wantedTypes.length ? (lead.wantedTypes.includes(p.type) ? 1 : 0) : 0.5,
      rooms: lead.minRooms ? (p.rooms >= lead.minRooms ? 1 : Math.max(0, 1 - (lead.minRooms - p.rooms) * 0.4)) : 0.5,
      garage: lead.needsGarage ? (p.garageSpots > 0 ? 1 : 0) : 1,
      operation: lead.wantsOperation ? (lead.wantsOperation === p.operation ? 1 : 0) : 0.5,
    };
    const score = Object.entries(W).reduce((acc, [k, w]) => acc + b[k] * w, 0) * 100;
    return { score: Math.round(score * 10) / 10, breakdown: b };
  }

  /** 1 dentro del presupuesto; decae linealmente hasta 0 al pasarse un 25%. */
  private budgetFit(lead: Lead, priceUsd: number): number {
    const max = lead.budgetMaxUsd;
    if (!max) return 0.5;
    if (lead.budgetMinUsd && priceUsd < lead.budgetMinUsd * 0.7) return 0.4;
    if (priceUsd <= max) return 1;
    return Math.max(0, 1 - (priceUsd - max) / (max * 0.25));
  }

  /** Lead scoring 0-100 según completitud del perfil, urgencia y actividad reciente. */
  async scoreLead(leadId: string): Promise<Lead> {
    const l = await this.leads.findOneOrFail({ where: { id: leadId } });
    const completeness =
      [l.budgetMaxUsd, l.wantsOperation, l.preferredNeighborhoods.length, l.wantedTypes.length || l.minRooms].filter(Boolean).length / 4;
    const daysIdle = l.lastInteractionAt ? (Date.now() - l.lastInteractionAt.getTime()) / 86_400_000 : 30;
    const recency = Math.max(0, 1 - daysIdle / 14);
    const mortgage = l.hasMortgageApproval ? 1 : 0;

    const before = l.temperature;
    l.leadScore = Math.round((completeness * 0.4 + l.urgency * 0.25 + recency * 0.25 + mortgage * 0.1) * 100);
    l.temperature = l.leadScore >= 70 ? LeadTemperature.CALIENTE : l.leadScore >= 40 ? LeadTemperature.TIBIO : LeadTemperature.FRIO;
    const saved = await this.leads.save(l);
    if (l.temperature === LeadTemperature.CALIENTE && before !== LeadTemperature.CALIENTE) {
      await this.notifications.notify(
        NotificationType.LEAD_CALIENTE,
        `Lead caliente: ${l.fullName ?? l.phone ?? l.email ?? 'sin nombre'}`,
        `Puntaje ${l.leadScore}/100. Buen momento para contactarlo.`,
        l.id,
      );
    }
    return saved;
  }
}
