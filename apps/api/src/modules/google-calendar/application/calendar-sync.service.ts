import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Visit, VisitStatus } from '../../visits/domain/visit.entity';
import { GoogleCalendarLink } from '../domain/google-calendar-link.entity';
import { CalendarEvent, GoogleApiError, GoogleCalendarClient } from '../infrastructure/google-calendar.client';
import { GoogleOAuthService } from '../infrastructure/google-oauth.service';
import { primaryWebOrigin } from '../../../shared/infrastructure/web-origin';

const TZ = 'America/Argentina/Buenos_Aires';
const ACTIVE = [VisitStatus.PENDIENTE, VisitStatus.CONFIRMADA];

/**
 * Mantiene cada visita reflejada en el Google Calendar del asesor a cargo del lead.
 * Nada de acá lanza: si Google falla, la visita igual queda guardada en el CRM (y se reintenta en el próximo cambio).
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);
  private readonly webOrigin: string;

  constructor(
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(GoogleCalendarLink) private readonly links: Repository<GoogleCalendarLink>,
    private readonly oauth: GoogleOAuthService,
    private readonly calendar: GoogleCalendarClient,
    config: ConfigService,
  ) {
    this.webOrigin = primaryWebOrigin(config.get<string>('WEB_ORIGIN'));
  }

  /** Crea, actualiza, mueve o borra el evento según el estado de la visita y el asesor del lead. */
  async syncVisit(visitId: string): Promise<void> {
    if (!this.oauth.isConfigured()) return;
    try {
      const visit = await this.visits.findOne({ where: { id: visitId }, relations: { lead: { assignedTo: true }, property: true } });
      if (!visit) return;

      const ownerId = visit.lead.assignedTo?.id ?? null;
      const link = ownerId ? await this.links.findOneBy({ userId: ownerId }) : null;
      const wanted = ACTIVE.includes(visit.status) && link !== null;

      // El evento está en otro calendario (cambió el asesor) o ya no corresponde: se saca de donde esté.
      if (visit.googleEventId && (!wanted || visit.googleCalendarOwnerId !== ownerId)) {
        await this.deleteEvent(visit);
        visit.googleEventId = null;
        visit.googleCalendarOwnerId = null;
        await this.visits.update(visit.id, { googleEventId: null, googleCalendarOwnerId: null });
      }
      if (!wanted) return;

      const event = this.toEvent(visit);
      const eventId = visit.googleEventId;
      if (eventId && (await this.withToken(link.userId, (t) => this.calendar.update(t, link.calendarId, eventId, event)))) return;

      const newId = await this.withToken(link.userId, (t) => this.calendar.insert(t, link.calendarId, event));
      await this.visits.update(visit.id, { googleEventId: newId, googleCalendarOwnerId: link.userId });
    } catch (err) {
      this.logger.warn(`No se pudo sincronizar la visita ${visitId} con Google Calendar: ${(err as Error).message}`);
    }
  }

  /** Lead reasignado: sus visitas se mueven al calendario del nuevo asesor. */
  async syncLead(leadId: string): Promise<void> {
    const rows = await this.visits.find({ select: { id: true }, where: { lead: { id: leadId } } });
    for (const v of rows) await this.syncVisit(v.id);
  }

  /** Al conectar la cuenta: se cargan las visitas activas desde hoy de los leads del asesor. */
  async backfillUser(userId: string): Promise<number> {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const rows = await this.visits.find({
      select: { id: true },
      where: { lead: { assignedTo: { id: userId } }, status: In(ACTIVE), startAt: MoreThan(since) },
    });
    for (const v of rows) await this.syncVisit(v.id);
    return rows.length;
  }

  /** Antes de borrar visitas (directo o en cascada por lead/propiedad) hay que sacar sus eventos. */
  async removeEvents(where: { visitId?: string; leadId?: string; propertyId?: string }): Promise<void> {
    if (!this.oauth.isConfigured()) return;
    const rows = await this.visits.find({
      where: {
        ...(where.visitId ? { id: where.visitId } : {}),
        ...(where.leadId ? { lead: { id: where.leadId } } : {}),
        ...(where.propertyId ? { property: { id: where.propertyId } } : {}),
      },
    });
    for (const v of rows.filter((x) => x.googleEventId)) {
      try {
        await this.deleteEvent(v);
      } catch (err) {
        this.logger.warn(`No se pudo borrar el evento de la visita ${v.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Al desconectar: los eventos quedan en su calendario (son suyos), pero el CRM deja de seguirlos. */
  async forgetUser(userId: string): Promise<void> {
    await this.visits.update({ googleCalendarOwnerId: userId }, { googleEventId: null, googleCalendarOwnerId: null });
  }

  private async deleteEvent(visit: Visit): Promise<void> {
    if (!visit.googleEventId || !visit.googleCalendarOwnerId) return;
    const link = await this.links.findOneBy({ userId: visit.googleCalendarOwnerId });
    if (!link) return; // desconectó su cuenta: el evento quedó en su calendario y ya no lo podemos tocar
    const eventId = visit.googleEventId;
    await this.withToken(link.userId, (t) => this.calendar.remove(t, link.calendarId, eventId));
  }

  /**
   * Si Google rechaza el token en caché (401: el usuario revocó el acceso o cambió la contraseña),
   * se pide uno nuevo y se reintenta una vez. Si el refresh también falla, accessToken() desconecta la cuenta.
   */
  private async withToken<T>(userId: string, fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.oauth.accessToken(userId));
    } catch (err) {
      if (!(err instanceof GoogleApiError) || err.status !== 401) throw err;
      this.oauth.invalidate(userId);
      return fn(await this.oauth.accessToken(userId));
    }
  }

  private toEvent(v: Visit): CalendarEvent {
    const client = v.lead.fullName ?? v.lead.phone ?? v.lead.email ?? 'cliente';
    const pending = v.status === VisitStatus.PENDIENTE;
    const end = new Date(v.startAt.getTime() + v.durationMin * 60_000);
    const lines = [
      pending ? 'Visita POR CONFIRMAR (la pidió el asistente o se cargó sin confirmar).' : 'Visita confirmada.',
      `Cliente: ${client}`,
      v.lead.phone ? `Teléfono: ${v.lead.phone}` : null,
      `Propiedad: ${v.property.title}`,
      v.notes ? `Notas: ${v.notes}` : null,
      '',
      `Ver en el CRM: ${this.webOrigin}`,
    ];
    return {
      summary: `${pending ? 'Por confirmar: ' : ''}Visita con ${client} · ${v.property.title}`,
      location: [v.property.address, v.property.neighborhood, v.property.city].filter(Boolean).join(', '),
      description: lines.filter((l) => l !== null).join('\n'),
      start: { dateTime: v.startAt.toISOString(), timeZone: TZ },
      end: { dateTime: end.toISOString(), timeZone: TZ },
    };
  }
}
