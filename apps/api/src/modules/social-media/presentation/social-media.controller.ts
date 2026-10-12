import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/domain/pagination';
import { ContentService } from '../application/content.service';
import { PostingTimeOptimizer } from '../application/posting-time.optimizer';
import { PublishingService } from '../application/publishing.service';
import { SocialPostsService } from '../application/social-posts.service';
import { PostStatus, SocialPlatform } from '../domain/social-post.entity';

class GenerateDto {
  @IsEnum(SocialPlatform) platform: SocialPlatform;
  @IsEnum(['propiedad', 'oportunidad_inversion']) goal: 'propiedad' | 'oportunidad_inversion';
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsBoolean() scheduleAuto?: boolean;
}

class PostContentDto {
  @IsOptional() @IsString() @MaxLength(5000) copy?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) hashtags?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Hasta 10 fotos por publicación' })
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true, message: 'Las fotos tienen que tener un link https://' })
  mediaUrls?: string[];
  /** null = sin propiedad asociada */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() propertyId?: string | null;
  /** Fecha y hora para publicar sola (ISO con zona). null = sacar la programación (vuelve a borrador). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate({ message: 'scheduledAt tiene que ser una fecha ISO válida' })
  scheduledAt?: Date | null;
}

class CreatePostDto extends PostContentDto {
  @IsArray() @ArrayMinSize(1, { message: 'Elegí al menos una red' }) @IsEnum(SocialPlatform, { each: true }) platforms: SocialPlatform[];
}

class PostListQuery extends PaginationQuery {
  @IsOptional() @IsEnum(PostStatus) status?: PostStatus;
  @IsOptional() @IsEnum(SocialPlatform) platform?: SocialPlatform;
}

@Controller('social')
export class SocialMediaController {
  constructor(
    private readonly content: ContentService,
    private readonly publishing: PublishingService,
    private readonly optimizer: PostingTimeOptimizer,
    private readonly socialPosts: SocialPostsService,
  ) {}

  /** Qué redes están configuradas en el servidor. */
  @Get('status')
  status() {
    return this.socialPosts.status();
  }

  @Get('posts')
  list(@Query() q: PostListQuery) {
    return this.socialPosts.list(q);
  }

  @Get('posts/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.socialPosts.findOne(id);
  }

  /** Crea una publicación por cada red elegida (mismo texto y fotos). Con scheduledAt quedan programadas. */
  @Post('posts')
  create(@Body() dto: CreatePostDto) {
    const { platforms, ...input } = dto;
    return this.socialPosts.create(platforms, input);
  }

  @Patch('posts/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostContentDto) {
    return this.socialPosts.update(id, dto);
  }

  /** Borra del CRM. Si ya estaba publicada, en la red queda: hay que borrarla desde Facebook o Instagram. */
  @Delete('posts/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.socialPosts.remove(id);
  }

  /** Publicar ya (ignora el horario programado). */
  @Post('posts/:id/publish')
  @HttpCode(200)
  async publishNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.publishing.publishOne(await this.socialPosts.findOne(id));
  }

  /** Programa en la fecha indicada, o en el mejor horario según las métricas si no se indica. */
  @Post('posts/:id/schedule')
  @HttpCode(200)
  async schedule(@Param('id', ParseUUIDPipe) id: string, @Body('at') at?: string) {
    const post = await this.socialPosts.findOne(id);
    const when = at ? new Date(at) : await this.content.nextBestSlot(post.platform);
    return this.socialPosts.update(id, { scheduledAt: when });
  }

  /** Genera un borrador con IA (necesita ANTHROPIC_API_KEY). */
  @Post('generate')
  generate(@Body() dto: GenerateDto) {
    return this.content.generateDraft(dto);
  }

  @Get('best-times')
  bestTimes(@Query('platform') platform: SocialPlatform) {
    return this.optimizer.bestSlots(platform);
  }
}
