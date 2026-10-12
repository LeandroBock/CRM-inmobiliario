import type { Property } from './properties';

export type Platform = 'facebook' | 'instagram' | 'tiktok';
export type PostStatus = 'borrador' | 'programado' | 'publicando' | 'publicado' | 'fallido';

export interface SocialPost {
  id: string;
  platform: Platform | 'linkedin';
  format: string;
  copy: string;
  hashtags: string[];
  mediaUrls: string[];
  status: PostStatus;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  externalUrl?: string | null;
  errorMessage?: string | null;
  property?: { id: string; title: string } | null;
  platformOptions?: TikTokOptions;
  createdAt: string;
}

export interface TikTokOptions {
  privacyLevel?: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
}

/** Cuenta de TikTok conectada y lo que permite (TikTok exige mostrarlo antes de publicar). */
export interface TikTokCreatorInfo {
  creatorNickname: string;
  creatorUsername: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export const TIKTOK_PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todos',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (se siguen mutuamente)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Solo yo (privado)',
};

export const isVideoUrl = (url: string) => /\.(mp4|mov)(\?.*)?$/i.test(url);

export const PLATFORMS: { value: Platform; label: string; videoOnly?: boolean }[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok', videoOnly: true },
];

export const POST_STATUSES: { value: PostStatus; label: string; bg: string; fg: string }[] = [
  { value: 'borrador', label: 'Borrador', bg: '#e7e9ee', fg: '#495057' },
  { value: 'programado', label: 'Programada', bg: '#dbe4ff', fg: '#364fc7' },
  { value: 'publicando', label: 'Publicando…', bg: '#fff3bf', fg: '#e67700' },
  { value: 'publicado', label: 'Publicada', bg: '#d3f9d8', fg: '#2b8a3e' },
  { value: 'fallido', label: 'Falló', bg: '#ffe3e3', fg: '#c92a2a' },
];

export const INSTAGRAM_MAX_CAPTION = 2200;
export const MAX_POST_PHOTOS = 10;

/** Texto final como lo verá la red: el texto y los hashtags al final. */
export function captionOf(copy: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => `#${h}`).join(' ');
  return [copy.trim(), tags].filter(Boolean).join('\n\n');
}

/** "#Rosario, depto venta" -> ["Rosario", "depto", "venta"] */
export function parseHashtags(raw: string): string[] {
  const out: string[] = [];
  for (const t of raw.split(/[\s,]+/)) {
    const tag = t.replace(/^#+/, '').trim();
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** Hashtag válido a partir de un texto: sin espacios, tildes ni signos ("Villa Gobernador Gálvez" -> "VillaGobernadorGalvez"). */
function toTag(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/** Texto sugerido para publicar una propiedad (sin IA: con los datos cargados). */
export function suggestFromProperty(p: Property, formatUsd: (n: number) => string): { copy: string; hashtags: string[] } {
  const venta = p.operation === 'venta';
  const lines = [
    `${venta ? '🏡 EN VENTA' : '🔑 EN ALQUILER'} · ${p.title}`,
    `📍 ${p.neighborhood}, ${p.city}`,
    [p.rooms ? `${p.rooms} ambientes` : null, `${p.coveredM2} m² cubiertos`, p.garageSpots > 0 ? 'cochera' : null].filter(Boolean).join(' · '),
    p.amenities?.length ? `✨ ${p.amenities.slice(0, 5).join(' · ')}` : null,
    `💰 ${formatUsd(p.priceUsd)}`,
    '',
    'Escribinos por WhatsApp para coordinar una visita.',
  ];
  const hashtags = [p.city, p.neighborhood, p.type, venta ? 'venta' : 'alquiler', 'inmobiliaria']
    .map((t) => toTag(String(t ?? '')))
    .filter(Boolean)
    .filter((t, i, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  return { copy: lines.filter((l) => l !== null).join('\n'), hashtags };
}
