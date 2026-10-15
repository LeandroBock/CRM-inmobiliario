import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, ServiceUnavailableException } from '@nestjs/common';
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
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/domain/pagination';
import { ContentService, CopyTone } from '../application/content.service';
import { PostingTimeOptimizer } from '../application/posting-time.optimizer';
import { PublishingService } from '../application/publishing.service';
import { SocialPostsService } from '../application/social-posts.service';
import { PostStatus, SocialPlatform } from '../domain/social-post.entity';
import { TikTokAuthService } from '../infrastructure/tiktok/tiktok-auth.service';

class GenerateDto {
  @IsEnum(SocialPlatform) platform: SocialPlatform;
  @IsEnum(['propiedad', 'oportunidad_inversion']) goal: 'propiedad' | 'oportunidad_inversion';
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsBoolean() scheduleAuto?: boolean;
}

const TONES: CopyTone[] = ['cercano', 'profesional', 'entusiasta', 'premium'];

class CurrentTextDto {
  @IsOptional() @IsString() @MaxLength(5000) copy?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) hashtags?: string[];
}

class AiPostDto {
  @IsOptional() @IsUUID() propertyId?: string;
  @IsArray() @ArrayMinSize(1, { message: 'Elegí al menos una red' }) @IsEnum(SocialPlatform, { each: true }) platforms: SocialPlatform[];
  @IsOptional() @IsBoolean() video?: boolean;
  @IsOptional() @IsIn(TONES) tone?: CopyTone;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
  /** Texto a reescribir. Sin él, la IA escribe uno nuevo. */
  @IsOptional() @ValidateNested() @Type(() => CurrentTextDto) current?: CurrentTextDto;
}

class AiReelDto {
  @IsUUID() propertyId: string;
  @IsInt() @Min(1) @Max(10) photoCount: number;
  @IsOptional() @IsIn(TONES) tone?: CopyTone;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}

class AiListingDto {
  @IsUUID() propertyId: string;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}

class PlatformOptionsDto {
  @IsOptional() @IsIn(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']) privacyLevel?: string;
  @IsOptional() @IsBoolean() disableComment?: boolean;
  @IsOptional() @IsBoolean() disableDuet?: boolean;
  @IsOptional() @IsBoolean() disableStitch?: boolean;
}

class PostContentDto {
  @IsOptional() @IsString() @MaxLength(5000) copy?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) hashtags?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Hasta 10 fotos por publicación' })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false }, { each: true, message: 'Las fotos y videos tienen que tener un link https://' })
  mediaUrls?: string[];
  /** Opciones de TikTok (privacidad elegida por el usuario, comentarios, dúos, stitch). */
  @IsOptional() @ValidateNested() @Type(() => PlatformOptionsDto) platformOptions?: PlatformOptionsDto;
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

/** Cuánto espera "publicar ya" antes de responder y seguir en segundo plano. */
const PUBLISH_WAIT_MS = Number(process.env.PUBLISH_WAIT_MS ?? 25_000);

@Controller('social')
export class SocialMediaController {
  constructor(
    private readonly content: ContentService,
    private readonly publishing: PublishingService,
    private readonly optimizer: PostingTimeOptimizer,
    private readonly socialPosts: SocialPostsService,
    private readonly tiktok: TikTokAuthService,
  ) {}

  /** Qué redes están listas para publicar. */
  @Get('status')
  status() {
    return this.socialPosts.status();
  }

  /** Cuenta de TikTok conectada y sus opciones de publicación (TikTok exige mostrarlas antes de publicar). */
  @Get('tiktok/creator-info')
  tiktokCreatorInfo() {
    return this.tiktok.creatorInfo().catch((err: Error) => {
      throw new ServiceUnavailableException(err.message);
    });
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

  /**
   * Publicar ya (ignora el horario programado). Las fotos salen en segundos; un video puede tardar minutos en
   * procesarse: pasados ~25 s se responde con la publicación en "publicando" y termina sola (la pantalla se actualiza).
   */
  @Post('posts/:id/publish')
  @HttpCode(200)
  async publishNow(@Param('id', ParseUUIDPipe) id: string) {
    const publishing = this.publishing.publishOne(await this.socialPosts.findOne(id));
    const slow = new Promise<null>((r) => setTimeout(() => r(null), PUBLISH_WAIT_MS).unref());
    const done = await Promise.race([publishing, slow]);
    if (done) return done;
    publishing.catch(() => undefined); // sigue en segundo plano; el resultado queda en la base
    return this.socialPosts.findOne(id);
  }

  /** Programa en la fecha indicada, o en el mejor horario según las métricas si no se indica. */
  @Post('posts/:id/schedule')
  @HttpCode(200)
  async schedule(@Param('id', ParseUUIDPipe) id: string, @Body('at') at?: string) {
    const post = await this.socialPosts.findOne(id);
    const when = at ? new Date(at) : await this.content.nextBestSlot(post.platform);
    return this.socialPosts.update(id, { scheduledAt: when });
  }

  /** Si la IA (Claude) está configurada: sin ANTHROPIC_API_KEY la pantalla deshabilita los botones de IA. */
  @Get('ai')
  aiStatus() {
    return this.content.aiStatus();
  }

  /** Escribe (o reescribe) el texto y los hashtags de una publicación con IA. */
  @Post('ai/post')
  @HttpCode(200)
  aiPost(@Body() dto: AiPostDto) {
    return this.content.writePost(dto);
  }

  /** Textos del reel (portada y uno por foto) con IA. */
  @Post('ai/reel')
  @HttpCode(200)
  aiReel(@Body() dto: AiReelDto) {
    return this.content.writeReel(dto);
  }

  /** Título y descripción para portales inmobiliarios con IA. */
  @Post('ai/listing')
  @HttpCode(200)
  aiListing(@Body() dto: AiListingDto) {
    return this.content.writeListing(dto);
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
