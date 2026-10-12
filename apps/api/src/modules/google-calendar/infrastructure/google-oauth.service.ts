import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { SecretBox } from '../../../shared/infrastructure/secret-box';
import { GoogleCalendarLink } from '../domain/google-calendar-link.entity';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
/** Solo eventos (no puede leer ni borrar calendarios enteros) + el email para mostrar la cuenta conectada. */
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];
const STATE_TTL_MS = 10 * 60 * 1000;

/** El usuario revocó el acceso desde su cuenta de Google (o venció): hay que volver a conectar. */
export class GoogleDisconnectedError extends Error {}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri: string;
  private readonly stateSecret: string;
  private readonly box?: SecretBox;
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    config: ConfigService,
    @InjectRepository(GoogleCalendarLink) private readonly links: Repository<GoogleCalendarLink>,
  ) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID') || undefined;
    this.clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET') || undefined;
    const publicUrl = (config.get<string>('PUBLIC_URL') ?? `http://localhost:${config.get('PORT') ?? 3000}`).replace(/\/+$/, '');
    this.redirectUri = config.get<string>('GOOGLE_REDIRECT_URI') || `${publicUrl}/integrations/google/callback`;
    this.stateSecret = config.getOrThrow<string>('JWT_SECRET');
    const key = config.get<string>('TOKEN_ENCRYPTION_KEY');
    if (key) this.box = new SecretBox(key);
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.box);
  }

  /** URL de Google a la que se manda al usuario. `state` lleva su id firmado: el callback es público. */
  authUrl(userId: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline', // para recibir refresh token
      prompt: 'consent', // Google solo manda refresh token en el primer consentimiento si no se fuerza
      include_granted_scopes: 'true',
      state: this.signState(userId),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /** Devuelve el userId si el state es auténtico y no venció; si no, null. */
  verifyState(state: string): string | null {
    const [payload, sig] = state.split('.');
    if (!payload || !sig) return null;
    // Se compara el texto (no los bytes decodificados): base64url ignora bits sobrantes del último carácter.
    const expected = Buffer.from(createHmac('sha256', this.stateSecret).update(payload).digest('base64url'));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return typeof u === 'string' && typeof exp === 'number' && exp > Date.now() ? u : null;
    } catch {
      return null;
    }
  }

  /** Canjea el código del callback y guarda la conexión (cifrada). */
  async connect(userId: string, code: string): Promise<GoogleCalendarLink> {
    const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
    if (!tokens.refresh_token) throw new Error('Google no entregó un refresh token');
    const email = tokens.id_token ? this.emailFromIdToken(tokens.id_token) : null;

    await this.links.delete({ userId });
    await this.links.insert({
      userId,
      googleEmail: email ?? 'cuenta de Google',
      refreshTokenEnc: this.box!.seal(tokens.refresh_token),
      calendarId: 'primary',
    });
    this.accessTokens.set(userId, { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
    return this.links.findOneByOrFail({ userId });
  }

  async disconnect(userId: string): Promise<void> {
    const link = await this.links.createQueryBuilder('g').addSelect('g.refreshTokenEnc').where('g.userId = :userId', { userId }).getOne();
    this.accessTokens.delete(userId);
    if (!link) return;
    await this.links.delete({ userId });
    // Se revoca del lado de Google también, así el permiso desaparece de su cuenta.
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: this.box!.open(link.refreshTokenEnc) }),
    }).catch((err) => this.logger.warn(`No se pudo revocar el token en Google: ${(err as Error).message}`));
  }

  /** Google rechazó el token en caché (401): se descarta para pedir otro. */
  invalidate(userId: string): void {
    this.accessTokens.delete(userId);
  }

  /** Token de acceso vigente (se renueva con el refresh token y se cachea ~1 h). */
  async accessToken(userId: string): Promise<string> {
    const cached = this.accessTokens.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const link = await this.links.createQueryBuilder('g').addSelect('g.refreshTokenEnc').where('g.userId = :userId', { userId }).getOne();
    if (!link) throw new GoogleDisconnectedError('Sin cuenta de Google conectada');
    try {
      const tokens = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.box!.open(link.refreshTokenEnc) });
      this.accessTokens.set(userId, { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
      return tokens.access_token;
    } catch (err) {
      if (err instanceof GoogleDisconnectedError) {
        // Revocado desde Google: se borra la conexión para que el CRM le muestre "Conectar" de nuevo.
        await this.links.delete({ userId });
        this.logger.warn(`Google revocó el acceso del usuario ${userId}; se desconectó su calendario`);
      }
      throw err;
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId!, client_secret: this.clientSecret!, ...params }),
    });
    const body = (await res.json()) as TokenResponse;
    if (body.error === 'invalid_grant') throw new GoogleDisconnectedError(body.error_description ?? 'invalid_grant');
    if (!res.ok || !body.access_token) throw new Error(`Google OAuth: ${body.error_description ?? body.error ?? res.status}`);
    return body;
  }

  private signState(userId: string): string {
    const payload = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString('hex') })).toString('base64url');
    return `${payload}.${createHmac('sha256', this.stateSecret).update(payload).digest('base64url')}`;
  }

  /** El id_token llega directo del endpoint de Google por TLS, así que alcanza con leer su contenido. */
  private emailFromIdToken(idToken: string): string | null {
    try {
      return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email ?? null;
    } catch {
      return null;
    }
  }
}
