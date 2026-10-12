import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { ContentService } from '../application/content.service';
import { PostingTimeOptimizer } from '../application/posting-time.optimizer';
import { PublishingService } from '../application/publishing.service';
import { PostStatus, SocialPlatform, SocialPost } from '../domain/social-post.entity';

class GenerateDto {
  @IsEnum(SocialPlatform) platform: SocialPlatform;
  @IsEnum(['propiedad', 'oportunidad_inversion']) goal: 'propiedad' | 'oportunidad_inversion';
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsBoolean() scheduleAuto?: boolean;
}

@Controller('social')
export class SocialMediaController {
  constructor(
    private readonly content: ContentService,
    private readonly publishing: PublishingService,
    private readonly optimizer: PostingTimeOptimizer,
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
  ) {}

  @Post('generate')
  generate(@Body() dto: GenerateDto) {
    return this.content.generateDraft(dto);
  }

  /** Publicar ya (ignora el horario programado). */
  @Post('posts/:id/publish')
  async publishNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.publishing.publishOne(await this.posts.findOneOrFail({ where: { id } }));
  }

  @Post('posts/:id/schedule')
  async schedule(@Param('id', ParseUUIDPipe) id: string, @Body('at') at?: string) {
    const post = await this.posts.findOneOrFail({ where: { id } });
    post.scheduledAt = at ? new Date(at) : await this.content.nextBestSlot(post.platform);
    post.status = PostStatus.PROGRAMADO;
    return this.posts.save(post);
  }

  @Get('best-times')
  bestTimes(@Query('platform') platform: SocialPlatform) {
    return this.optimizer.bestSlots(platform);
  }
}
