import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/domain/user.entity';
import { ChatHistory } from '../communication/domain/chat-history.entity';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { LeadEngineModule } from '../lead-engine/lead-engine.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadAssignmentService } from './application/lead-assignment.service';
import { LeadsService } from './application/leads.service';
import { Lead } from './domain/lead.entity';
import { LeadsController } from './presentation/leads.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, ChatHistory, User]), LeadEngineModule, NotificationsModule, GoogleCalendarModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadAssignmentService],
  exports: [LeadsService, LeadAssignmentService],
})
export class LeadsModule {}
