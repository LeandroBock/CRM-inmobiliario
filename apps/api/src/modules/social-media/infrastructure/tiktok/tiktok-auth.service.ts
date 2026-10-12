import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecretBox } from '../../../../shared/infrastructure/secret-box';
import { signState, verifyState } from '../../../../shared/infrastructure/signed-state';
import { TikTokAccount } from '../../domain/tiktok-account.entity';

const ACCOUNT_ID = 'principal';
/** Solo lo necesario: ver el nombre de la cuenta y publicar videos. */
const SCOPES = ['user.info.basic', 'video.publish'];

/** TikTok rechazó el token (permiso revocado o vencido): hay que volver a conectar la cuenta. */
export class TikTokDisconnectedError extends Error {}

/** Error de la API de TikTok con su código (p. ej. unaudited_client_can_only_post_to_private_accounts). */
export class TikTokApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface CreatorInfo {
  creatorNickname: string;
  creatorUsername: string;
  /** Opciones de privacidad que permite la cuenta (TikTok exige mostrarlas y que el usuario elija). */
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

/** Mensajes en castellano para los errores de TikTok más comunes. */
const TIKTOK_ERRORS: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    'Mientras TikTok no apruebe (audite) la app, solo se puede publicar en cuentas privadas. Poné la cuenta en privado o pedí la auditoría en TikTok for Developers.',
  privacy_level_option_mismatch: 'La privacidad elegida no está permitida para esta cuenta. Elegí una de las opciones que muestra el CRM.',
  spam_risk_too_many_posts: 'TikTok frenó la publicación: se alcanzó el límite de publicaciones del día para esta cuenta.',
  spam_risk_user_banned_from_posting: 'TikTok no deja publicar con esta cuenta por ahora.',
  reached_active_user_cap: 'La app alcanzó el máximo de usuarios por día que permite TikTok sin auditoría.',
  access_token_invalid: 'TikTok no aceptó el acceso: volvé a conectar la cuenta.',
  scope_not_authorized: 'La cuenta no dio permiso para publicar: volvé a conectarla aceptando todos los permisos.',
};

/**
 * Conexión de la cuenta de TikTok de la inmobiliaria (Login Kit, OAuth 2.0) y pedidos a su API.
 * El token de acceso dura 24 h y se renueva solo con el de refresco (dura un año).
 */
@Injectable()
export class TikTokAuthService {
  private readonly logger = new Logger(TikTokAuthService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TikTokAccount) private readonly accounts: Repository<TikTokAccount>,
  ) {}

  private get clientKey() {
    return this.config.get<string>('TIKTOK_CLIENT_KEY')?.trim();
  }
  private get clientSecret() {
    return this.config.get<string>('TIKTOK_CLIENT_SECRET')?.trim();
  }
  private get box(): SecretBox | null {
    const key = this.config.get<string>('TOKEN_ENCRYPTION_KEY')?.trim();
    return key ? new SecretBox(key) : null;
  }
  /** Base de la API (TIKTOK_API_URL permite apuntar a un servidor de prueba). */
  private get api() {
    return (this.config.get<string>('TIKTOK_API_URL')?.trim() || 'https://open.tiktokapis.com').replace(/\/+$/, '');
  }
  private get redirectUri() {
    const publicUrl = (this.config.get<string>('PUBLIC_URL') ?? `http://localhost:${this.config.get('PORT') ?? 3000}`).replace(/\/+$/, '');
    return this.config.get<string>('TIKTOK_REDIRECT_URI')?.trim() || `${publicUrl}/integrations/tiktok/callback`;
  }

  /** Están las claves de la app de TikTok (y la de cifrado para guardar los tokens). */
  isConfigured(): boolean {
    return Boolean(this.clientKey && this.clientSecret && this.box);
  }

  async account(): Promise<TikTokAccount | null> {
    return this.accounts.findOneBy({ id: ACCOUNT_ID });
  }

  authUrl(userId: string): string {
    const params = new URLSearchParams({
      client_key: this.clientKey!,
      scope: SCOPES.join(','),
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state: signState(userId, this.config.getOrThrow<string>('JWT_SECRET')),
    });
    const authBase = (this.config.get<string>('TIKTOK_AUTH_URL')?.trim() || 'https://www.tiktok.com/v2/auth/authorize/').replace(/\/?$/, '/');
    return `${authBase}?${params.toString()}`;
  }

  verifyState(state: string): string | null {
    return verifyState(state, this.config.getOrThrow<string>('JWT_SECRET'));
  }

  /** Canjea el código del callback, consulta el nombre de la cuenta y guarda todo (tokens cifrados). */
  async connect(userId: string, code: string): Promise<TikTokAccount> {
    const t = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
    const scopes = (t.scope ?? '').split(',');
    if (!scopes.includes('video.publish')) throw new TikTokApiError('scope_not_authorized', TIKTOK_ERRORS.scope_not_authorized);
    const info = await this.call<{ user?: { display_name?: string; username?: string } }>(
      'GET',
      '/v2/user/info/?fields=open_id,display_name,username',
      t.access_token!,
    ).catch(() => ({ user: undefined }));

    await this.accounts.delete({ id: ACCOUNT_ID });
    await this.accounts.insert({
      id: ACCOUNT_ID,
      openId: t.open_id!,
      displayName: info.user?.display_name ?? null,
      username: info.user?.username ?? null,
      scope: t.scope ?? null,
      ...this.sealTokens(t),
      connectedBy: userId,
    });
    return (await this.account())!;
  }

  /** Desconecta: revoca el permiso en TikTok (si se puede) y borra los tokens. */
  async disconnect(): Promise<void> {
    const row = await this.withTokens();
    await this.accounts.delete({ id: ACCOUNT_ID });
    if (!row || !this.box) return;
    await fetch(`${this.api}/v2/oauth/revoke/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: this.clientKey!, client_secret: this.clientSecret!, token: this.box.open(row.accessTokenEnc) }),
    }).catch((err) => this.logger.warn(`No se pudo revocar el acceso en TikTok: ${(err as Error).message}`));
  }

  /** Opciones de la cuenta para publicar (privacidad, si permite comentarios, duración máxima...). */
  async creatorInfo(): Promise<CreatorInfo> {
    const d = await this.call<{
      creator_nickname: string;
      creator_username: string;
      privacy_level_options: string[];
      comment_disabled: boolean;
      duet_disabled: boolean;
      stitch_disabled: boolean;
      max_video_post_duration_sec: number;
    }>('POST', '/v2/post/publish/creator_info/query/', await this.accessToken(), {});
    return {
      creatorNickname: d.creator_nickname,
      creatorUsername: d.creator_username,
      privacyLevelOptions: d.privacy_level_options ?? [],
      commentDisabled: Boolean(d.comment_disabled),
      duetDisabled: Boolean(d.duet_disabled),
      stitchDisabled: Boolean(d.stitch_disabled),
      maxVideoPostDurationSec: d.max_video_post_duration_sec ?? 0,
    };
  }

  /** Token de acceso vigente (lo renueva si vence en menos de 5 minutos). */
  async accessToken(): Promise<string> {
    const row = await this.withTokens();
    if (!row) throw new TikTokDisconnectedError('No hay una cuenta de TikTok conectada (Redes → Conectar TikTok)');
    const box = this.box;
    if (!box) throw new Error('Falta TOKEN_ENCRYPTION_KEY');
    if (row.accessExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return box.open(row.accessTokenEnc);
    if (row.refreshExpiresAt.getTime() <= Date.now()) {
      await this.accounts.delete({ id: ACCOUNT_ID });
      throw new TikTokDisconnectedError('Venció la conexión con TikTok: volvé a conectar la cuenta');
    }
    try {
      const t = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: box.open(row.refreshTokenEnc) });
      await this.accounts.update({ id: ACCOUNT_ID }, this.sealTokens(t));
      return t.access_token!;
    } catch (err) {
      if (err instanceof TikTokDisconnectedError) await this.accounts.delete({ id: ACCOUNT_ID });
      throw err;
    }
  }

  /**
   * Pedido a la API de TikTok. Toda respuesta trae { data, error: { code, message } }: code "ok" es éxito.
   * `body` = JSON; sin body, GET.
   */
  async call<T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
    const code = json.error?.code ?? (res.ok ? 'ok' : `http_${res.status}`);
    if (code !== 'ok') {
      if (code === 'access_token_invalid') throw new TikTokDisconnectedError(TIKTOK_ERRORS.access_token_invalid);
      throw new TikTokApiError(code, TIKTOK_ERRORS[code] ?? `TikTok: ${json.error?.message || code}`);
    }
    return json.data as T;
  }

  private async withTokens(): Promise<TikTokAccount | null> {
    return this.accounts
      .createQueryBuilder('t')
      .addSelect(['t.accessTokenEnc', 't.refreshTokenEnc'])
      .where('t.id = :id', { id: ACCOUNT_ID })
      .getOne();
  }

  private sealTokens(t: TokenResponse) {
    const box = this.box!;
    const now = Date.now();
    return {
      accessTokenEnc: box.seal(t.access_token!),
      accessExpiresAt: new Date(now + (t.expires_in ?? 86400) * 1000),
      refreshTokenEnc: box.seal(t.refresh_token!),
      refreshExpiresAt: new Date(now + (t.refresh_expires_in ?? 365 * 86400) * 1000),
    };
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(`${this.api}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: this.clientKey!, client_secret: this.clientSecret!, ...params }),
    });
    const t = (await res.json().catch(() => ({}))) as TokenResponse;
    if (t.error === 'invalid_grant') throw new TikTokDisconnectedError('TikTok no aceptó la conexión (permiso revocado o vencido): volvé a conectar la cuenta');
    if (!res.ok || t.error || !t.access_token || !t.refresh_token) throw new Error(`TikTok: ${t.error_description || t.error || res.status}`);
    return t;
  }
}
