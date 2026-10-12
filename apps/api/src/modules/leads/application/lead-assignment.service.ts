import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthUser } from '../../auth/domain/auth.types';
import { User } from '../../auth/domain/user.entity';
import { UserRole } from '../../auth/domain/user-role.enum';
import { CalendarSyncService } from '../../google-calendar/application/calendar-sync.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { NotificationType } from '../../notifications/domain/notification.entity';
import { Lead } from '../domain/lead.entity';

/** Etapas que ya no cargan al asesor: no cuentan para repartir. */
const CLOSED_STAGES = ['cerrado', 'perdido'];

@Injectable()
export class LeadAssignmentService {
  private readonly logger = new Logger(LeadAssignmentService.name);

  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly calendar: CalendarSyncService,
  ) {}

  /**
   * Reparto automático de leads nuevos (los de WhatsApp): al asesor activo con menos leads abiertos.
   * Si no hay asesores, a un admin. Se desactiva con AUTO_ASSIGN_LEADS=false (quedan sin asignar).
   */
  async autoAssign(lead: Lead): Promise<void> {
    if (this.config.get('AUTO_ASSIGN_LEADS') === 'false') return;
    try {
      const userId = (await this.leastLoaded(UserRole.AGENT)) ?? (await this.leastLoaded(UserRole.ADMIN));
      if (!userId) return;
      await this.leads.update(lead.id, { assignedTo: { id: userId } });
      lead.assignedTo = { id: userId } as User;
      await this.notifications.notify(
        NotificationType.LEAD_ASIGNADO,
        `Nuevo lead por WhatsApp: ${lead.fullName ?? lead.phone ?? 'sin nombre'}`,
        'Te lo asignó el reparto automático.',
        lead.id,
      );
    } catch (err) {
      this.logger.error(`No se pudo asignar el lead ${lead.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Reglas: un admin asigna cualquier lead a cualquiera. Un asesor puede tomar un lead sin asignar
   * o pasar uno suyo (a otro asesor o dejarlo sin asignar), pero no sacarle un lead a un compañero.
   */
  async assign(leadId: string, userId: string | null, actor: AuthUser): Promise<void> {
    const lead = await this.leads.findOne({ where: { id: leadId }, relations: { assignedTo: true } });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    const current = lead.assignedTo?.id ?? null;
    if (current === userId) return;

    if (actor.role !== UserRole.ADMIN && current !== null && current !== actor.id) {
      throw new ForbiddenException('Este lead lo tiene otro asesor. Pedile que te lo pase o a un administrador.');
    }
    const target = userId ? await this.assertAssignable(userId) : null;

    await this.leads.update(leadId, { assignedTo: target ? { id: target.id } : null });
    await this.notifications.reassignLead(leadId, target?.id ?? null);
    await this.calendar.syncLead(leadId); // sus visitas pasan al calendario del nuevo asesor
    // A quien se lo asignó otra persona se le avisa; si lo tomó uno mismo, no hace falta.
    if (target && target.id !== actor.id) {
      await this.notifications.notify(
        NotificationType.LEAD_ASIGNADO,
        `Te asignaron a ${lead.fullName ?? lead.phone ?? lead.email ?? 'un lead'}`,
        undefined,
        leadId,
      );
    }
  }

  async assertAssignable(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId, isActive: true } });
    if (!user) throw new BadRequestException('El asesor no existe o está inactivo');
    return user;
  }

  private async leastLoaded(role: UserRole): Promise<string | null> {
    const row = await this.users
      .createQueryBuilder('u')
      .leftJoin(Lead, 'l', 'l.assigned_user_id = u.id AND l.stage NOT IN (:...closed)', { closed: CLOSED_STAGES })
      .select('u.id', 'id')
      .where('u.is_active = true AND u.role = :role', { role })
      .groupBy('u.id')
      .orderBy('COUNT(l.id)', 'ASC')
      .addOrderBy('MIN(u.created_at)', 'ASC')
      .limit(1)
      .getRawOne<{ id: string }>();
    return row?.id ?? null;
  }
}
