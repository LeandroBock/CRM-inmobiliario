import { Controller, Delete, Get, HttpCode, Logger, Post, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthUser } from '../../auth/domain/auth.types';
import { CurrentUser, Public } from '../../auth/presentation/decorators';
import { CalendarSyncService } from '../application/calendar-sync.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleCalendarLink } from '../domain/google-calendar-link.entity';
import { GoogleOAuthService } from '../infrastructure/google-oauth.service';
import { primaryWebOrigin } from '../../../shared/infrastructure/web-origin';

@Controller('integrations/google')
export class GoogleCalendarController {
  private readonly logger = new Logger(GoogleCalendarController.name);
  private readonly webOrigin: string;

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly sync: CalendarSyncService,
    @InjectRepository(GoogleCalendarLink) private readonly links: Repository<GoogleCalendarLink>,
    config: ConfigService,
  ) {
    this.webOrigin = primaryWebOrigin(config.get<string>('WEB_ORIGIN'));
  }

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const link = await this.links.findOneBy({ userId: user.id });
    return { configured: this.oauth.isConfigured(), connected: !!link, email: link?.googleEmail ?? null };
  }

  /** Devuelve la URL de Google; la web redirige ahí al usuario. */
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentUser() user: AuthUser) {
    if (!this.oauth.isConfigured()) {
      throw new ServiceUnavailableException('Google Calendar no está configurado (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY)');
    }
    return { url: this.oauth.authUrl(user.id) };
  }

  /**
   * Google vuelve acá después del consentimiento. Es público (el navegador no manda nuestro token):
   * el usuario se identifica con el `state` firmado que generó /connect.
   */
  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const back = (result: string) => res.redirect(`${this.webOrigin}/?google=${result}`);
    if (error) return back(error === 'access_denied' ? 'cancelado' : 'error');
    const userId = state ? this.oauth.verifyState(state) : null;
    if (!userId || !code || !this.oauth.isConfigured()) return back('error');
    try {
      await this.oauth.connect(userId, code);
      await this.sync.backfillUser(userId);
      return back('conectado');
    } catch (err) {
      this.logger.error(`Falló la conexión con Google del usuario ${userId}: ${(err as Error).message}`);
      return back('error');
    }
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthUser) {
    await this.sync.forgetUser(user.id);
    await this.oauth.disconnect(user.id);
  }
}
