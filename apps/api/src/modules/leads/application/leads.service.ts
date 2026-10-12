import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { AuthUser } from '../../auth/domain/auth.types';
import { Paginated } from '../../../shared/domain/pagination';
import { definedOnly } from '../../../shared/domain/defined-only';
import { normalizePhoneAR } from '../../../shared/domain/phone';
import { ChatHistory } from '../../communication/domain/chat-history.entity';
import { CalendarSyncService } from '../../google-calendar/application/calendar-sync.service';
import { MatchingService } from '../../lead-engine/application/matching.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { Lead } from '../domain/lead.entity';
import { CreateLeadWithAssigneeDto, LeadQuery, UpdateLeadDto } from '../presentation/lead.dto';
import { LeadAssignmentService } from './lead-assignment.service';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private readonly repo: Repository<Lead>,
    @InjectRepository(ChatHistory) private readonly chats: Repository<ChatHistory>,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
    private readonly assignment: LeadAssignmentService,
    private readonly calendar: CalendarSyncService,
  ) {}

  async create(dto: CreateLeadWithAssigneeDto, actor: AuthUser): Promise<Lead> {
    if (!dto.phone && !dto.email) throw new BadRequestException('Indicá al menos un teléfono o un email');
    const { assignedUserId, ...data } = dto;
    if (assignedUserId) await this.assignment.assertAssignable(assignedUserId); // antes de guardar nada
    const entity = this.repo.create({ ...data, phone: dto.phone ? normalizePhoneAR(dto.phone) : undefined });
    const saved = await this.saveAndScore(entity);
    // Por defecto queda a cargo de quien lo carga; las mismas reglas que al reasignar.
    await this.assignment.assign(saved.id, assignedUserId ?? actor.id, actor);
    return this.findOne(saved.id);
  }

  async findAll(q: LeadQuery): Promise<Paginated<Lead>> {
    const qb = this.withAssignee();
    if (q.stage) qb.andWhere('l.stage = :stage', { stage: q.stage });
    if (q.temperature) qb.andWhere('l.temperature = :temp', { temp: q.temperature });
    if (q.assignedTo === 'none') qb.andWhere('l.assigned_user_id IS NULL');
    else if (q.assignedTo) qb.andWhere('l.assigned_user_id = :assignee', { assignee: q.assignedTo === 'me' ? q.currentUserId : q.assignedTo });
    if (q.q) {
      qb.andWhere('(l.full_name ILIKE :text OR l.phone ILIKE :text OR l.email ILIKE :text)', { text: `%${q.q}%` });
    }
    const [items, total] = await qb
      .orderBy('l.lead_score', 'DESC')
      .addOrderBy('l.created_at', 'DESC')
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .getManyAndCount();
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string): Promise<Lead> {
    const lead = await this.withAssignee().where('l.id = :id', { id }).getOne();
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  /** Del asesor solo se exponen id y nombre (nada de email, rol, últimos accesos...). */
  private withAssignee(): SelectQueryBuilder<Lead> {
    return this.repo.createQueryBuilder('l').leftJoin('l.assignedTo', 'a').addSelect(['a.id', 'a.fullName']);
  }

  async update(id: string, dto: UpdateLeadDto): Promise<Lead> {
    const lead = await this.findOne(id);
    const { phone, ...rest } = dto;
    Object.assign(lead, definedOnly(rest));
    // null borra el dato (el formulario lo manda así cuando se vacía el campo)
    if (phone !== undefined) lead.phone = phone ? normalizePhoneAR(phone) : (null as unknown as undefined);
    if (!lead.phone && !lead.email) throw new BadRequestException('El lead tiene que quedar con un teléfono o un email');
    await this.saveAndScore(lead);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.calendar.removeEvents({ leadId: id }); // las visitas se borran en cascada: antes, sus eventos
    const res = await this.repo.delete(id); // borra también su historial de chat, matches y visitas (cascade)
    if (!res.affected) throw new NotFoundException('Lead no encontrado');
    await this.notifications.removeForLead(id);
  }

  /** Conversación del lead con el asistente, de la más vieja a la más nueva. */
  async chatHistory(id: string, limit = 100): Promise<ChatHistory[]> {
    await this.findOne(id);
    const rows = await this.chats.find({ where: { lead: { id } }, order: { createdAt: 'DESC' }, take: limit });
    return rows.reverse();
  }

  /** Guarda y recalcula puntaje/temperatura, así el lead siempre queda calificado. */
  private async saveAndScore(lead: Lead): Promise<Lead> {
    let saved: Lead;
    try {
      saved = await this.repo.save(lead);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('Ya existe un lead con ese teléfono');
      throw err;
    }
    return this.matching.scoreLead(saved.id);
  }
}
