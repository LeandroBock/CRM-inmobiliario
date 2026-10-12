import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/domain/user.entity';
import { Lead } from '../leads/domain/lead.entity';
import { NotificationsService } from './application/notifications.service';
import { Notification } from './domain/notification.entity';
import { Mailer } from './infrastructure/mailer';
import { NotificationsController } from './presentation/notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, Lead, User])],
  controllers: [NotificationsController],
  providers: [NotificationsService, Mailer],
  exports: [NotificationsService],
})
export class NotificationsModule {}
