import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Visit } from '../visits/domain/visit.entity';
import { CalendarSyncService } from './application/calendar-sync.service';
import { GoogleCalendarLink } from './domain/google-calendar-link.entity';
import { GoogleCalendarClient } from './infrastructure/google-calendar.client';
import { GoogleOAuthService } from './infrastructure/google-oauth.service';
import { GoogleCalendarController } from './presentation/google-calendar.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GoogleCalendarLink, Visit])],
  controllers: [GoogleCalendarController],
  providers: [GoogleOAuthService, GoogleCalendarClient, CalendarSyncService],
  exports: [CalendarSyncService],
})
export class GoogleCalendarModule {}
