import { Controller, Delete, Get, HttpCode, Logger, Post, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { primaryWebOrigin } from '../../../shared/infrastructure/web-origin';
import { UserRole } from '../../auth/domain/user-role.enum';
import type { AuthUser } from '../../auth/domain/auth.types';
import { CurrentUser, Public, Roles } from '../../auth/presentation/decorators';
import { TikTokAuthService } from '../infrastructure/tiktok/tiktok-auth.service';

/** Conexión de la cuenta de TikTok de la inmobiliaria (una sola; la conecta un administrador). */
@Controller('integrations/tiktok')
export class TikTokController {
  private readonly logger = new Logger(TikTokController.name);
  private readonly webOrigin: string;

  constructor(
    private readonly tiktok: TikTokAuthService,
    config: ConfigService,
  ) {
    this.webOrigin = primaryWebOrigin(config.get<string>('WEB_ORIGIN'));
  }

  @Get('status')
  async status() {
    const account = await this.tiktok.account();
    return {
      configured: this.tiktok.isConfigured(),
      connected: Boolean(account),
      displayName: account?.displayName ?? null,
      username: account?.username ?? null,
    };
  }

  @Post('connect')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  connect(@CurrentUser() user: AuthUser) {
    if (!this.tiktok.isConfigured()) {
      throw new ServiceUnavailableException('TikTok no está configurado en el servidor (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY)');
    }
    return { url: this.tiktok.authUrl(user.id) };
  }

  /** TikTok vuelve acá después del permiso. Público: el usuario se identifica con el state firmado. */
  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const back = (result: string) => res.redirect(`${this.webOrigin}/?tiktok=${result}`);
    if (error) return back(error === 'access_denied' ? 'cancelado' : 'error');
    const userId = state ? this.tiktok.verifyState(state) : null;
    if (!userId || !code || !this.tiktok.isConfigured()) return back('error');
    try {
      await this.tiktok.connect(userId, code);
      return back('conectado');
    } catch (err) {
      this.logger.error(`Falló la conexión con TikTok: ${(err as Error).message}`);
      return back('error');
    }
  }

  @Delete()
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  async disconnect() {
    await this.tiktok.disconnect();
  }
}
