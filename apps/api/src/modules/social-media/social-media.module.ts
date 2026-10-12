import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvoModule } from '../avo/avo.module';
import { Property } from '../properties/domain/property.entity';
import { ContentService } from './application/content.service';
import { PostingTimeOptimizer } from './application/posting-time.optimizer';
import { MediaModule } from '../media/media.module';
import { TikTokAccount } from './domain/tiktok-account.entity';
import { TikTokAuthService } from './infrastructure/tiktok/tiktok-auth.service';
import { TikTokController } from './presentation/tiktok.controller';
import { SocialPostsService } from './application/social-posts.service';
import { PublishingService } from './application/publishing.service';
import { SOCIAL_PUBLISHERS } from './domain/social-publisher.interface';
import { SocialPost } from './domain/social-post.entity';
import { LinkedInPublisher } from './infrastructure/linkedin.publisher';
import { FacebookPublisher, InstagramPublisher } from './infrastructure/meta.publisher';
import { TikTokPublisher } from './infrastructure/tiktok.publisher';
import { SocialMediaController } from './presentation/social-media.controller';

@Module({
  imports: [HttpModule, AvoModule, MediaModule, TypeOrmModule.forFeature([SocialPost, Property, TikTokAccount])],
  controllers: [SocialMediaController, TikTokController],
  providers: [
    ContentService,
    PostingTimeOptimizer,
    PublishingService,
    SocialPostsService,
    TikTokAuthService,
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
