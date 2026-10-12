import { ConfigService } from '@nestjs/config';

/** Versión de la Graph API de Meta (WhatsApp, Facebook, Instagram). Meta saca una nueva cada ~6 meses y las viejas vencen. */
export const DEFAULT_GRAPH_VERSION = 'v25.0';

/** Base de la Graph API: https://graph.facebook.com/v25.0 (META_GRAPH_URL permite apuntar a un servidor de prueba). */
export function graphBase(config: ConfigService): string {
  const host = (config.get<string>('META_GRAPH_URL')?.trim() || 'https://graph.facebook.com').replace(/\/+$/, '');
  return `${host}/${config.get<string>('META_GRAPH_VERSION')?.trim() || DEFAULT_GRAPH_VERSION}`;
}

/** El motivo que da Meta cuando rechaza un pedido (el mensaje "para el usuario" si lo hay), o el error de red. */
export function graphErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string; error_user_msg?: string; error_user_title?: string } } }; message?: string };
  const g = e.response?.data?.error;
  if (g) return [g.error_user_title, g.error_user_msg || g.message].filter(Boolean).join(': ');
  return e.message ?? String(err);
}
