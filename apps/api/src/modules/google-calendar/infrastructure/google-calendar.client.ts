import { Injectable } from '@nestjs/common';

const API = 'https://www.googleapis.com/calendar/v3/calendars';

export class GoogleApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

/** Lo mínimo de Google Calendar API v3 que usa el CRM: crear, actualizar y borrar eventos. */
@Injectable()
export class GoogleCalendarClient {
  async insert(token: string, calendarId: string, event: CalendarEvent): Promise<string> {
    const res = await this.request(token, 'POST', `${API}/${encodeURIComponent(calendarId)}/events`, event);
    return ((await res.json()) as { id: string }).id;
  }

  /** false si el evento ya no existe (lo borró el usuario a mano): hay que crearlo de nuevo. */
  async update(token: string, calendarId: string, eventId: string, event: CalendarEvent): Promise<boolean> {
    const res = await this.request(token, 'PUT', this.eventUrl(calendarId, eventId), event, [404, 410]);
    return res.ok;
  }

  async remove(token: string, calendarId: string, eventId: string): Promise<void> {
    await this.request(token, 'DELETE', this.eventUrl(calendarId, eventId), undefined, [404, 410]); // ya borrado: ok
  }

  private eventUrl(calendarId: string, eventId: string) {
    return `${API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  }

  private async request(token: string, method: string, url: string, body?: unknown, allowed: number[] = []): Promise<Response> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !allowed.includes(res.status)) {
      const detail = await res.text().catch(() => '');
      throw new GoogleApiError(res.status, `Google Calendar ${method} ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res;
  }
}
