import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../../auth/domain/user.entity';
import { UserRole } from '../../auth/domain/user-role.enum';
import { Lead } from '../../leads/domain/lead.entity';
import { Mailer } from '../infrastructure/mailer';
import { Notification, NotificationType } from '../domain/notification.entity';
import { primaryWebOrigin } from '../../../shared/infrastructure/web-origin';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly webOrigin: string;

  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mailer: Mailer,
    config: ConfigService,
  ) {
    this.webOrigin = primaryWebOrigin(config.get<string>('WEB_ORIGIN'));
  }

  /**
   * Crea un aviso para el asesor a cargo del lead (o para todo el equipo si no tiene).
   * Si ya hay uno sin leer del mismo tipo para el mismo lead, lo actualiza y lo sube al principio
   * en vez de duplicarlo (un cliente que manda 5 mensajes = 1 aviso).
   * Nunca lanza: un aviso que falla no puede romper el flujo que lo disparó.
   */
  async notify(type: NotificationType, title: string, body?: string, leadId?: string): Promise<void> {
    try {
      const userId = leadId ? await this.assigneeOf(leadId) : null;
      const existing = leadId ? await this.repo.findOne({ where: { type, leadId, readAt: IsNull() } }) : null;
      if (existing) {
        await this.repo.update(existing.id, { title, body, userId, createdAt: new Date() });
      } else {
        await this.repo.insert({ type, title, body, leadId, userId });
        // Email solo para avisos nuevos: si el cliente sigue escribiendo, el aviso se actualiza sin mandar otro.
        // Sin await: el SMTP puede tardar y esto corre dentro del webhook o de un request del CRM.
        void this.email(userId, title, body, leadId);
      }
    } catch (err) {
      this.logger.error(`No se pudo crear el aviso ${type}: ${(err as Error).message}`);
    }
  }

  /**
   * Aviso de un contrato de alquiler, para todo el equipo. Mientras siga sin leer se actualiza en vez de repetirse
   * (el control diario lo vuelve a generar cada día).
   */
  async notifyContract(type: NotificationType, title: string, body: string | undefined, contractId: string): Promise<void> {
    try {
      const existing = await this.repo.findOne({ where: { type, contractId, readAt: IsNull() } });
      if (existing) {
        if (existing.title !== title || existing.body !== body) await this.repo.update(existing.id, { title, body });
        return;
      }
      await this.repo.insert({ type, title, body, contractId, userId: null });
      void this.email(null, title, body, undefined);
    } catch (err) {
      this.logger.error(`No se pudo crear el aviso ${type}: ${(err as Error).message}`);
    }
  }

  /** Avisos sin leer de un contrato que ya no corresponden (p. ej. se pagó la deuda): se marcan leídos. */
  async resolveContract(type: NotificationType, contractId: string): Promise<void> {
    await this.repo.update({ type, contractId, readAt: IsNull() }, { readAt: new Date() });
  }

  list(userId: string, unreadOnly: boolean): Promise<Notification[]> {
    const qb = this.visibleTo(userId).orderBy('n.createdAt', 'DESC').take(50);
    if (unreadOnly) qb.andWhere('n.read_at IS NULL');
    return qb.getMany();
  }

  unreadCount(userId: string): Promise<number> {
    return this.visibleTo(userId).andWhere('n.read_at IS NULL').getCount();
  }

  async markRead(id: string, userId: string): Promise<void> {
    const n = await this.visibleTo(userId).andWhere('n.id = :id', { id }).getOne();
    if (!n) throw new NotFoundException('Aviso no encontrado');
    if (!n.readAt) await this.repo.update(id, { readAt: new Date() });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.repo
      .createQueryBuilder()
      .update()
      .set({ readAt: new Date() })
      .where('read_at IS NULL')
      .andWhere('(user_id = :userId OR user_id IS NULL)', { userId })
      .execute();
    return { updated: res.affected ?? 0 };
  }

  /** Al atender al lead (responderle) sus avisos dejan de estar pendientes. */
  async markLeadRead(leadId: string): Promise<void> {
    await this.repo.update({ leadId, readAt: IsNull() }, { readAt: new Date() });
  }

  /** Al reasignar un lead, sus avisos pendientes pasan al nuevo asesor. */
  async reassignLead(leadId: string, userId: string | null): Promise<void> {
    await this.repo.update({ leadId, readAt: IsNull() }, { userId });
  }

  async removeForLead(leadId: string): Promise<void> {
    await this.repo.delete({ leadId });
  }

  private async email(userId: string | null, title: string, body?: string, leadId?: string): Promise<void> {
    if (!this.mailer.isConfigured()) return;
    try {
      // Con asesor: a él. Sin asesor: a los admins (para que alguien lo tome).
      const recipients = userId
        ? await this.users.find({ where: { id: userId, isActive: true, emailAlerts: true } })
        : await this.users.find({ where: { role: UserRole.ADMIN, isActive: true, emailAlerts: true } });
      if (!recipients.length) return;

      const link = leadId ? `${this.webOrigin}/?lead=${leadId}` : this.webOrigin;
      const text = [title, body, '', `Abrir en el CRM: ${link}`, '', 'Podés apagar estos emails desde la campana de avisos del CRM.']
        .filter((l) => l !== undefined)
        .join('\n');
      const html = `
        <div style="font-family:system-ui,sans-serif;font-size:15px;color:#1f2937;max-width:520px">
          <p style="font-size:17px;font-weight:600;margin:0 0 8px">${escapeHtml(title)}</p>
          ${body ? `<p style="margin:0 0 16px;color:#495057">${escapeHtml(body)}</p>` : ''}
          <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2f5bea;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Abrir en el CRM</a></p>
          <p style="font-size:12px;color:#868e96;margin-top:24px">Podés apagar estos emails desde la campana de avisos del CRM.</p>
        </div>`;
      await this.mailer.send({ to: recipients.map((u) => u.email), subject: `CRM · ${title}`, text, html });
    } catch (err) {
      this.logger.error(`No se pudo preparar el email del aviso: ${(err as Error).message}`);
    }
  }

  private visibleTo(userId: string): SelectQueryBuilder<Notification> {
    return this.repo
      .createQueryBuilder('n')
      .where(new Brackets((w) => w.where('n.user_id = :userId', { userId }).orWhere('n.user_id IS NULL')));
  }

  private async assigneeOf(leadId: string): Promise<string | null> {
    const row = await this.leads
      .createQueryBuilder('l')
      .select('l.assigned_user_id', 'userId')
      .where('l.id = :leadId', { leadId })
      .getRawOne<{ userId: string | null }>();
    return row?.userId ?? null;
  }
}

/** Lo que escribe un cliente (nombre, mensaje) termina en el HTML del email: se escapa siempre. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
