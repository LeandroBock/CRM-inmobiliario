import { Controller, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { AuthUser } from '../../auth/domain/auth.types';
import { CurrentUser } from '../../auth/presentation/decorators';
import { NotificationsService } from '../application/notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread', new ParseBoolPipe({ optional: true })) unread?: boolean) {
    return this.notifications.list(user.id, unread ?? false);
  }

  /** La web lo consulta cada 30 s: no cuenta para el límite de velocidad. */
  @Get('unread-count')
  @SkipThrottle()
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  @HttpCode(204)
  async markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.notifications.markRead(id, user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }
}
