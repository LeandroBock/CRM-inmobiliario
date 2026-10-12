import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { Lead } from '../leads/domain/lead.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Property } from '../properties/domain/property.entity';
import { VisitsService } from './application/visits.service';
import { Visit } from './domain/visit.entity';
import { VisitsController } from './presentation/visits.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Visit, Lead, Property]), NotificationsModule, GoogleCalendarModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
