import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { definedOnly } from '../../../shared/domain/defined-only';
import { CalendarSyncService } from '../../google-calendar/application/calendar-sync.service';
import { Lead, LeadStage } from '../../leads/domain/lead.entity';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationType } from '../../notifications/domain/notification.entity';
import { Property } from '../../properties/domain/property.entity';
import { Visit, VisitSource, VisitStatus } from '../domain/visit.entity';
import { CreateVisitDto, UpdateVisitDto, VisitQuery } from '../presentation/visit.dto';

/** Etapas desde las que agendar una visita hace avanzar al lead a "visita agendada". */
const EARLY_STAGES = [LeadStage.NUEVO, LeadStage.CALIFICADO];
const ACTIVE = [VisitStatus.PENDIENTE, VisitStatus.CONFIRMADA];

@Injectable()
export class VisitsService {
  constructor(
    @InjectRepository(Visit) private readonly repo: Repository<Visit>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    private readonly notifications: NotificationsService,
    private readonly calendar: CalendarSyncService,
  ) {}

  async create(dto: CreateVisitDto, source = VisitSource.ASESOR): Promise<Visit> {
    const lead = await this.leads.findOne({ where: { id: dto.leadId } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const property = await this.properties.findOne({ where: { id: dto.propertyId } });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    if (source === VisitSource.ASISTENTE && dto.startAt.getTime() < Date.now()) {
      throw new BadRequestException('La fecha de la visita ya pasó');
    }

    const durationMin = dto.durationMin ?? 45;
    await this.assertFree(property.id, dto.startAt, durationMin);

    const visit = await this.repo.save(
      this.repo.create({
        lead,
        property,
        startAt: dto.startAt,
        durationMin,
        // Lo que agenda el asistente siempre lo confirma una persona.
        status: source === VisitSource.ASISTENTE ? VisitStatus.PENDIENTE : (dto.status ?? VisitStatus.CONFIRMADA),
        source,
        notes: dto.notes,
      }),
    );
    if (EARLY_STAGES.includes(lead.stage)) await this.leads.update(lead.id, { stage: LeadStage.VISITA_AGENDADA });
    await this.calendar.syncVisit(visit.id);
    if (source === VisitSource.ASISTENTE) {
      const when = dto.startAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'full', timeStyle: 'short' });
      await this.notifications.notify(
        NotificationType.VISITA_POR_CONFIRMAR,
        `Visita por confirmar: ${lead.fullName ?? lead.phone ?? 'cliente'}`,
        `${property.title} · ${when}`,
        lead.id,
      );
    }
    return visit;
  }

  /** Para el asistente de WhatsApp: los datos vienen del LLM y pueden ser inválidos. */
  async createFromAssistant(leadId: string, input: { property_id?: unknown; start_iso?: unknown }): Promise<Visit> {
    const propertyId = typeof input.property_id === 'string' ? input.property_id : '';
    const startAt = new Date(typeof input.start_iso === 'string' ? input.start_iso : NaN);
    if (!/^[0-9a-f-]{36}$/i.test(propertyId)) throw new BadRequestException('El asistente no indicó una propiedad válida');
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('El asistente no indicó una fecha válida');
    return this.create({ leadId, propertyId, startAt }, VisitSource.ASISTENTE);
  }

  list(q: VisitQuery): Promise<Visit[]> {
    const qb = this.repo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.lead', 'lead')
      .leftJoinAndSelect('v.property', 'property')
      .leftJoin('lead.assignedTo', 'agent')
      .addSelect(['agent.id', 'agent.fullName'])
      .orderBy('v.startAt', 'ASC');
    if (q.from) qb.andWhere('v.start_at >= :from', { from: q.from });
    if (q.to) qb.andWhere('v.start_at < :to', { to: q.to });
    if (q.leadId) qb.andWhere('v.lead_id = :leadId', { leadId: q.leadId });
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.mine) qb.andWhere('lead.assigned_user_id = :me', { me: q.currentUserId });
    return qb.take(500).getMany();
  }

  async update(id: string, dto: UpdateVisitDto): Promise<Visit> {
    const visit = await this.repo.findOne({ where: { id }, relations: ['lead', 'property'] });
    if (!visit) throw new NotFoundException('Visita no encontrada');
    Object.assign(visit, definedOnly(dto));
    const reactivated = dto.status && ACTIVE.includes(dto.status);
    if ((dto.startAt || dto.durationMin || reactivated) && ACTIVE.includes(visit.status)) {
      await this.assertFree(visit.property.id, visit.startAt, visit.durationMin, visit.id);
    }
    const saved = await this.repo.save(visit);
    await this.calendar.syncVisit(saved.id);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.calendar.removeEvents({ visitId: id });
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException('Visita no encontrada');
  }

  /** Dos visitas activas a la misma propiedad no se pueden superponer. */
  private async assertFree(propertyId: string, startAt: Date, durationMin: number, exceptId?: string) {
    const qb = this.repo
      .createQueryBuilder('v')
      .where('v.property_id = :propertyId', { propertyId })
      .andWhere('v.status IN (:...active)', { active: ACTIVE })
      .andWhere("v.start_at < :end AND v.start_at + make_interval(mins => v.duration_min) > :start", {
        start: startAt,
        end: new Date(startAt.getTime() + durationMin * 60_000),
      });
    if (exceptId) qb.andWhere('v.id <> :exceptId', { exceptId });
    if (await qb.getExists()) throw new ConflictException('Ya hay otra visita a esa propiedad en ese horario');
  }
}
