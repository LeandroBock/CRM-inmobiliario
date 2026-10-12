import { Controller, Get, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../leads/domain/lead.entity';
import { MatchScore } from '../lead-engine/domain/match-score.entity';
import { SocialMediaModule } from '../social-media/social-media.module';
import { SocialPost } from '../social-media/domain/social-post.entity';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview() {
    return this.dashboard.getOverview();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Lead, MatchScore, SocialPost]), SocialMediaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
