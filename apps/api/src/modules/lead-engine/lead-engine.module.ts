import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../leads/domain/lead.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Property } from '../properties/domain/property.entity';
import { MatchingService } from './application/matching.service';
import { MatchScore } from './domain/match-score.entity';
import { LeadEngineController } from './presentation/lead-engine.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, Property, MatchScore]), NotificationsModule],
  controllers: [LeadEngineController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class LeadEngineModule {}
