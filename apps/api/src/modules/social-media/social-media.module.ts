import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvoModule } from '../avo/avo.module';
import { Property } from '../properties/domain/property.entity';
import { ContentService } from './application/content.service';
import { PostingTimeOptimizer } from './application/posting-time.optimizer';
import { SocialPostsService } from './application/social-posts.service';
import { PublishingService } from './application/publishing.service';
import { SOCIAL_PUBLISHERS } from './domain/social-publisher.interface';
import { SocialPost } from './domain/social-post.entity';
import { LinkedInPublisher } from './infrastructure/linkedin.publisher';
import { FacebookPublisher, InstagramPublisher } from './infrastructure/meta.publisher';
import { TikTokPublisher } from './infrastructure/tiktok.publisher';
import { SocialMediaController } from './presentation/social-media.controller';

@Module({
  imports: [HttpModule, AvoModule, TypeOrmModule.forFeature([SocialPost, Property])],
  controllers: [SocialMediaController],
  providers: [
    ContentService,
    PostingTimeOptimizer,
    PublishingService,
    SocialPostsService,
    InstagramPublisher,
    FacebookPublisher,
    LinkedInPublisher,
    TikTokPublisher,
    {
      provide: SOCIAL_PUBLISHERS,
      inject: [InstagramPublisher, FacebookPublisher, LinkedInPublisher, TikTokPublisher],
      useFactory: (...publishers) => publishers,
    },
  ],
  exports: [ContentService, PostingTimeOptimizer],
})
export class SocialMediaModule {}
