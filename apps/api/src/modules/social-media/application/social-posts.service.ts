import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Paginated } from '../../../shared/domain/pagination';
import { Property } from '../../properties/domain/property.entity';
import { isVideoUrl, VIDEO_STORAGE, VideoStorage } from '../../media/domain/video-storage.port';
import { PlatformOptions, PostFormat, PostStatus, SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { SOCIAL_PUBLISHERS, SocialPublisher } from '../domain/social-publisher.interface';
import { captionOf, MAX_PHOTOS_PER_POST } from '../infrastructure/meta.publisher';
import { TikTokAuthService } from '../infrastructure/tiktok/tiktok-auth.service';

/** Redes que se pueden usar desde la pantalla de publicaciones (LinkedIn: más adelante). */
export const SUPPORTED_PLATFORMS = [SocialPlatform.FACEBOOK, SocialPlatform.INSTAGRAM, SocialPlatform.TIKTOK];

const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
const NAMES: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

const MAX_CAPTION = 2200; // límite de Instagram (Facebook acepta más)
const MAX_HASHTAGS = 30; // límite de Instagram
/** Se puede editar o publicar en estos estados; publicado y publicando ya no. */
const EDITABLE = [PostStatus.BORRADOR, PostStatus.PROGRAMADO, PostStatus.FALLIDO];

export interface PostInput {
  copy?: string;
  hashtags?: string[];
  mediaUrls?: string[];
  propertyId?: string | null;
  scheduledAt?: Date | null;
  platformOptions?: PlatformOptions;
}

export interface PostQuery {
  status?: PostStatus;
  platform?: SocialPlatform;
  page: number;
  limit: number;
}

/** "#Rosario, departamento  #venta" -> ["Rosario", "departamento", "venta"] (sin #, sin repetidos). */
export function normalizeHashtags(tags: string[] = []): string[] {
  const out: string[] = [];
  for (const raw of tags.flatMap((t) => t.split(/[\s,]+/))) {
    const tag = raw.replace(/^#+/, '').trim();
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

@Injectable()
export class SocialPostsService {
  constructor(
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @Inject(SOCIAL_PUBLISHERS) private readonly publishers: SocialPublisher[],
    @Inject(VIDEO_STORAGE) private readonly videos: VideoStorage,
    private readonly tiktok: TikTokAuthService,
  ) {}

  /** Qué redes están listas para publicar (claves cargadas; TikTok, además, con la cuenta conectada). */
  async status(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const p of SUPPORTED_PLATFORMS) out[p] = Boolean(this.publishers.find((x) => x.platform === p)?.isConfigured());
    out.tiktok = out.tiktok && (await this.tiktok.account()) !== null;
    return out;
  }

  async list(q: PostQuery): Promise<Paginated<SocialPost>> {
    const qb = this.posts.createQueryBuilder('s').leftJoin('s.property', 'p').addSelect(['p.id', 'p.title']);
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.platform) qb.andWhere('s.platform = :platform', { platform: q.platform });
    // Lo próximo a salir y lo último publicado, arriba
    const [items, total] = await qb
      .orderBy('COALESCE(s.scheduled_at, s.published_at, s.created_at)', 'DESC')
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .getManyAndCount();
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string): Promise<SocialPost> {
    const post = await this.posts.findOne({ where: { id }, relations: { property: true } });
    if (!post) throw new NotFoundException('Publicación no encontrada');
    return post;
  }

  /** Una publicación por red, con el mismo contenido. */
  async create(platforms: SocialPlatform[], input: PostInput): Promise<SocialPost[]> {
    const unique = [...new Set(platforms)];
    const unsupported = unique.filter((p) => !SUPPORTED_PLATFORMS.includes(p));
    if (unsupported.length) throw new BadRequestException(`Todavía no se puede publicar en ${unsupported.join(', ')} desde el CRM`);
    const property = await this.property(input.propertyId);

    const drafts = unique.map((platform) => {
      const post = this.posts.create({ platform, copy: '', hashtags: [], mediaUrls: [], platformOptions: {}, status: PostStatus.BORRADOR });
      this.apply(post, input, property);
      return post;
    });
    const saved = await this.posts.save(drafts);
    return this.posts.find({ where: { id: In(saved.map((p) => p.id)) }, relations: { property: true } });
  }

  async update(id: string, input: PostInput): Promise<SocialPost> {
    const post = await this.findOne(id);
    if (!EDITABLE.includes(post.status)) throw new ConflictException('Esta publicación ya salió: no se puede editar');
    const property = input.propertyId === undefined ? post.property ?? null : await this.property(input.propertyId);
    this.apply(post, input, property);
    // Ojo: con save(), undefined no toca la columna; para borrar un dato hay que poner null.
    if (post.status !== PostStatus.FALLIDO) post.errorMessage = null; // se corrigió: vuelve a borrador o programada
    await this.posts.save(post);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const post = await this.findOne(id);
    if (post.status === PostStatus.PUBLICANDO) throw new ConflictException('Se está publicando en este momento: esperá a que termine');
    await this.posts.delete(id);
  }

  private async property(id: string | null | undefined): Promise<Property | null> {
    if (!id) return null;
    const property = await this.properties.findOne({ where: { id } });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    return property;
  }

  /** Aplica los cambios, valida para la red y deja el estado según haya o no fecha programada. */
  private apply(post: SocialPost, input: PostInput, property: Property | null): void {
    if (input.copy !== undefined) post.copy = input.copy.trim();
    if (input.hashtags !== undefined) post.hashtags = normalizeHashtags(input.hashtags);
    if (input.mediaUrls !== undefined) post.mediaUrls = [...new Set(input.mediaUrls.map((u) => u.trim()).filter(Boolean))];
    post.property = property ?? (null as unknown as undefined); // null = sacarle la propiedad
    if (input.platformOptions !== undefined && post.platform === SocialPlatform.TIKTOK) {
      const o = input.platformOptions;
      post.platformOptions = {
        privacyLevel: o.privacyLevel,
        disableComment: Boolean(o.disableComment),
        disableDuet: Boolean(o.disableDuet),
        disableStitch: Boolean(o.disableStitch),
      };
    }
    const video = post.mediaUrls.length === 1 && isVideoUrl(post.mediaUrls[0]);
    post.format = video
      ? post.platform === SocialPlatform.INSTAGRAM
        ? PostFormat.REEL
        : PostFormat.VIDEO
      : post.mediaUrls.length > 1
        ? PostFormat.CARRUSEL
        : post.mediaUrls.length === 1
          ? PostFormat.IMAGEN
          : PostFormat.TEXTO;

    if (input.scheduledAt !== undefined) {
      if (input.scheduledAt === null) {
        post.scheduledAt = null;
        post.status = PostStatus.BORRADOR;
      } else {
        if (input.scheduledAt.getTime() < Date.now() + 60_000) throw new BadRequestException('La fecha programada tiene que ser al menos dentro de un minuto');
        post.scheduledAt = input.scheduledAt;
        post.status = PostStatus.PROGRAMADO;
      }
    } else if (post.status === PostStatus.FALLIDO) {
      post.status = post.scheduledAt && post.scheduledAt.getTime() > Date.now() ? PostStatus.PROGRAMADO : PostStatus.BORRADOR;
    }
    this.validateForPlatform(post);
  }

  /** Reglas de cada red, para que el error aparezca al guardar y no recién al publicar. */
  private validateForPlatform(post: SocialPost): void {
    validateForPlatform(post);
    if (post.platform === SocialPlatform.TIKTOK) {
      if (!this.videos.fileNameFromUrl(post.mediaUrls[0])) throw new BadRequestException('TikTok: el video tiene que estar subido al CRM (no sirve un link externo)');
      const privacy = post.platformOptions?.privacyLevel;
      if (!privacy || !TIKTOK_PRIVACY.includes(privacy)) throw new BadRequestException('TikTok: elegí quién puede ver la publicación');
    }
  }
}

/** Reglas generales de cada red (sin depender del almacenamiento). */
export function validateForPlatform(post: Pick<SocialPost, 'platform' | 'copy' | 'hashtags' | 'mediaUrls'>): void {
  const name = NAMES[post.platform] ?? post.platform;
  const videos = post.mediaUrls.filter(isVideoUrl);
  if (videos.length && post.mediaUrls.length > 1) throw new BadRequestException(`${name}: un video por publicación, sin fotos`);
  if (post.mediaUrls.length > MAX_PHOTOS_PER_POST) throw new BadRequestException(`${name}: hasta ${MAX_PHOTOS_PER_POST} fotos por publicación`);
  if (post.mediaUrls.some((u) => !/^https:\/\//i.test(u))) throw new BadRequestException(`${name}: las fotos y videos tienen que tener un link público https://`);
  if (post.platform === SocialPlatform.TIKTOK) {
    if (videos.length !== 1) throw new BadRequestException('TikTok: hace falta un video');
    if (captionOf(post).length > MAX_CAPTION) throw new BadRequestException(`TikTok: el texto con los hashtags no puede pasar de ${MAX_CAPTION} caracteres`);
  } else if (post.platform === SocialPlatform.INSTAGRAM) {
    if (!post.mediaUrls.length) throw new BadRequestException('Instagram: hace falta una foto o un video');
    if (post.hashtags.length > MAX_HASHTAGS) throw new BadRequestException(`Instagram: hasta ${MAX_HASHTAGS} hashtags`);
    if (captionOf(post).length > MAX_CAPTION) throw new BadRequestException(`Instagram: el texto con los hashtags no puede pasar de ${MAX_CAPTION} caracteres`);
  } else if (!post.copy && !post.mediaUrls.length) {
    throw new BadRequestException('Facebook: escribí un texto o agregá una foto');
  }
}
