import type { Property } from './properties';

export const STAGES = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'calificado', label: 'Calificado' },
  { value: 'visita_agendada', label: 'Visita agendada' },
  { value: 'negociacion', label: 'Negociación' },
  { value: 'cerrado', label: 'Cerrado' },
  { value: 'perdido', label: 'Perdido' },
] as const;

export const TEMPERATURES = [
  { value: 'caliente', label: 'Caliente' },
  { value: 'tibio', label: 'Tibio' },
  { value: 'frio', label: 'Frío' },
] as const;

export const TEMPERATURE_COLORS: Record<string, { bg: string; fg: string }> = {
  caliente: { bg: '#ffe3e3', fg: '#c92a2a' },
  tibio: { bg: '#fff3bf', fg: '#e67700' },
  frio: { bg: '#e7f5ff', fg: '#1971c2' },
};

export interface Lead {
  id: string;
  fullName?: string | null;
  /** E.164: +5493415551234 */
  phone?: string | null;
  email?: string | null;
  stage: string;
  temperature: string;
  leadScore: number;
  budgetMinUsd?: number | null;
  budgetMaxUsd?: number | null;
  wantsOperation?: string | null;
  wantedTypes: string[];
  preferredNeighborhoods: string[];
  minRooms?: number | null;
  needsGarage: boolean;
  hasMortgageApproval?: boolean | null;
  /** 0 a 1, la estima el asistente a partir del chat. */
  urgency: number;
  /** El asistente no responde: lo atiende un asesor. */
  aiPaused: boolean;
  /** Asesor a cargo (null = sin asignar). */
  assignedTo?: { id: string; fullName: string } | null;
  lastInteractionAt?: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  channel: 'whatsapp' | 'web';
  role: 'user' | 'assistant' | 'agent' | 'system';
  content: string;
  /** Asesor que lo escribió (role = agent). */
  authorName?: string | null;
  /** Adjunto del cliente: en audios, `content` es la transcripción; en fotos, el epígrafe. */
  mediaType?: 'audio' | 'image' | null;
  mediaFile?: string | null;
  extractedData?: { toolCalls?: { name: string; input: Record<string, unknown> }[] } | null;
  createdAt: string;
}

export const FEEDBACKS = [
  { value: 'me_gusta', label: 'Le gusta' },
  { value: 'no_me_interesa', label: 'No le interesa' },
  { value: 'visito', label: 'Visitó' },
] as const;

export interface Match {
  id: string;
  score: number;
  /** Cada criterio de 0 a 1. */
  breakdown: Record<string, number>;
  feedback: 'pendiente' | 'me_gusta' | 'no_me_interesa' | 'visito';
  property: Property;
  createdAt: string;
}

/** Nombres de los criterios del MatchingService, en el orden en que pesan. */
export const BREAKDOWN_LABELS: Record<string, string> = {
  budget: 'Presupuesto',
  zone: 'Zona',
  type: 'Tipo',
  operation: 'Operación',
  rooms: 'Ambientes',
  garage: 'Cochera',
};

export function leadName(l: Pick<Lead, 'fullName' | 'phone' | 'email'>): string {
  return l.fullName?.trim() || l.phone || l.email || 'Sin nombre';
}

/** "+5493415551234" -> "+54 9 341 555-1234" (aproximado: el largo del código de área varía). */
export function formatPhone(e164?: string | null): string {
  if (!e164) return '';
  const m = e164.match(/^\+549(\d{3})(\d{3})(\d{4})$/);
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : e164;
}

/** Link para abrir el chat en WhatsApp Web / app. */
export function whatsappLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}

const dateTime = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
});
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** "hace 3 h", "hace 2 días"... para la última interacción. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return 'Nunca';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Recién';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Ayer' : `Hace ${days} días`;
}

// ---------------------------------------------------------------- visitas

export const VISIT_STATUSES = [
  { value: 'pendiente', label: 'Por confirmar' },
  { value: 'confirmada', label: 'Confirmada' },
  { value: 'realizada', label: 'Realizada' },
  { value: 'cancelada', label: 'Cancelada' },
] as const;

export const VISIT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pendiente: { bg: '#fff3bf', fg: '#e67700' },
  confirmada: { bg: '#d3f9d8', fg: '#2b8a3e' },
  realizada: { bg: '#e7e9ee', fg: '#495057' },
  cancelada: { bg: '#e7e9ee', fg: '#868e96' },
};

export interface Visit {
  id: string;
  startAt: string;
  durationMin: number;
  status: 'pendiente' | 'confirmada' | 'realizada' | 'cancelada';
  source: 'asistente' | 'asesor';
  notes?: string | null;
  /** Id del evento si está copiada en el Google Calendar del asesor. */
  googleEventId?: string | null;
  lead: Lead;
  property: Property;
}

/**
 * La agenda se maneja siempre en hora argentina, sin importar la zona de la compu.
 * Argentina no tiene horario de verano desde 2009: el offset es fijo -03:00.
 */
const AR_OFFSET = '-03:00';

/** Valor de <input type="datetime-local"> ("2026-10-15T17:00") -> ISO con hora argentina. */
export function localInputToIso(value: string): string {
  return `${value}:00${AR_OFFSET}`;
}

/** ISO -> valor para <input type="datetime-local">, en hora argentina. */
export function isoToLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 16);
}

const dayFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' });
const timeFmt = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
/** Clave YYYY-MM-DD del día en Argentina, para agrupar. */
export const dayKey = (iso: string) => isoToLocalInput(iso).slice(0, 10);
