import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AvoService } from '../../avo/application/avo.service';
import { Property } from '../../properties/domain/property.entity';
import { PostFormat, PostStatus, SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { ContentLlm, JsonSchema } from '../infrastructure/content-llm';
import { PostingTimeOptimizer } from './posting-time.optimizer';

export type ContentGoal = 'propiedad' | 'oportunidad_inversion';

const PLATFORM_GUIDE: Record<SocialPlatform, string> = {
  instagram: 'Instagram: copy de hasta 600 caracteres, gancho en la primera línea, 5 a 8 hashtags, emojis moderados.',
  facebook: 'Facebook: copy de 300 a 500 caracteres, tono cercano, una llamada a la acción clara.',
  linkedin: 'LinkedIn: tono profesional y analítico, enfocado en datos de mercado e inversión, sin hashtags excesivos (máximo 3).',
  tiktok: 'TikTok: guion de 20 a 30 segundos con gancho en los primeros 3 segundos, escenas numeradas y texto en pantalla.',
};

export type CopyTone = 'cercano' | 'profesional' | 'entusiasta' | 'premium';

const TONES: Record<CopyTone, string> = {
  cercano: 'cercano y cálido, como un asesor de confianza del barrio',
  profesional: 'profesional y claro, sin exagerar',
  entusiasta: 'entusiasta y con energía, con emojis',
  premium: 'elegante y sobrio, para un público de alto poder adquisitivo, pocos emojis',
};

const BASE_SYSTEM =
  'Sos redactor de marketing inmobiliario en Argentina. Escribí en español rioplatense (voseo). ' +
  'Usá SOLO los datos provistos: no inventes características, cifras, distancias ni servicios. ' +
  'Los precios van en dólares (USD) tal como figuran. No prometas rentabilidades ni uses frases discriminatorias. ' +
  'No incluyas la dirección exacta ni datos de contacto: el cierre invita a escribir por WhatsApp o por mensaje privado.';

export interface PostText {
  copy: string;
  hashtags: string[];
}

export interface ReelText {
  kicker: string;
  title: string;
  captions: string[];
}

const POST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    copy: { type: 'string', description: 'Texto de la publicación, sin hashtags' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags sin #, sin espacios ni tildes' },
  },
  required: ['copy', 'hashtags'],
  additionalProperties: false,
};

const REEL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    kicker: { type: 'string', description: 'Rótulo corto arriba de la portada, en mayúsculas (máx. 22 caracteres)' },
    title: { type: 'string', description: 'Título de la portada (máx. 45 caracteres)' },
    captions: { type: 'array', items: { type: 'string' }, description: 'Un texto por foto, en orden (máx. 38 caracteres cada uno)' },
  },
  required: ['kicker', 'title', 'captions'],
  additionalProperties: false,
};

@Injectable()
export class ContentService {
  constructor(
    private readonly llm: ContentLlm,
    private readonly avo: AvoService,
    private readonly optimizer: PostingTimeOptimizer,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
  ) {}

  aiStatus() {
    return { configured: this.llm.isConfigured() };
  }

  /**
   * Escribe el texto y los hashtags de una publicación con IA. Con `current` reescribe ese texto
   * (más corto, otro tono, lo que digan las indicaciones); si no, lo escribe desde cero con los datos de la propiedad.
   */
  async writePost(opts: {
    propertyId?: string;
    platforms: SocialPlatform[];
    video?: boolean;
    tone?: CopyTone;
    instructions?: string;
    current?: { copy?: string; hashtags?: string[] };
  }): Promise<PostText> {
    const current = opts.current?.copy?.trim();
    if (!opts.propertyId && !current && !opts.instructions?.trim()) {
      throw new BadRequestException('Elegí una propiedad, escribí un texto para mejorar o contale a la IA de qué tiene que tratar');
    }
    const property = opts.propertyId ? await this.properties.findOneOrFail({ where: { id: opts.propertyId } }) : undefined;
    const prompt = [
      `Redes donde se publica: ${opts.platforms.map((p) => PLATFORM_GUIDE[p]).join(' ')}`,
      opts.platforms.includes(SocialPlatform.TIKTOK) || opts.video
        ? 'Acompaña un video vertical: el texto es corto (hasta 300 caracteres) y complementa lo que se ve.'
        : 'Acompaña fotos de la propiedad.',
      'Un solo texto que sirva para todas esas redes: gancho en la primera línea, datos clave en líneas cortas, llamada a la acción al final. Entre 5 y 8 hashtags relevantes (zona, tipo de propiedad, operación).',
      `Tono: ${TONES[opts.tone ?? 'cercano']}.`,
      property ? `DATOS DE LA PROPIEDAD:\n${describeProperty(property)}` : '',
      current
        ? `TEXTO ACTUAL (reescribilo; mantené los datos que tiene salvo que las indicaciones digan otra cosa):\n${current}` +
          (opts.current?.hashtags?.length ? `\nHashtags actuales: ${opts.current.hashtags.join(' ')}` : '')
        : '',
      opts.instructions?.trim() ? `INDICACIONES DEL ASESOR: ${opts.instructions.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const out = await this.llm.json<PostText>(BASE_SYSTEM, prompt, POST_SCHEMA);
    return { copy: out.copy.trim().slice(0, 2200), hashtags: cleanHashtags(out.hashtags) };
  }

  /** Textos del reel (rótulo, título y un texto por foto), cortos para que entren en la pantalla del video. */
  async writeReel(opts: { propertyId: string; photoCount: number; tone?: CopyTone; instructions?: string }): Promise<ReelText> {
    const property = await this.properties.findOneOrFail({ where: { id: opts.propertyId } });
    const prompt = [
      `Textos para un reel vertical de ${opts.photoCount} fotos de esta propiedad. Portada: un rótulo arriba (p. ej. "EN VENTA", "OPORTUNIDAD", "A ESTRENAR") y un título con gancho.`,
      `Después, exactamente ${opts.photoCount} textos cortos, uno por foto, que vayan contando la propiedad (ubicación, ambientes, comodidades, lo que la hace especial). Podés usar un emoji al principio. No repitas el precio: va en una etiqueta aparte.`,
      `Tono: ${TONES[opts.tone ?? 'cercano']}.`,
      `DATOS DE LA PROPIEDAD:\n${describeProperty(property)}`,
      opts.instructions?.trim() ? `INDICACIONES DEL ASESOR: ${opts.instructions.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const out = await this.llm.json<ReelText>(BASE_SYSTEM, prompt, REEL_SCHEMA);
    const captions = Array.from({ length: opts.photoCount }, (_, i) => (out.captions[i] ?? '').trim().slice(0, 60));
    return { kicker: out.kicker.trim().toUpperCase().slice(0, 30), title: out.title.trim().slice(0, 70), captions };
  }

  /** Genera un borrador usando datos reales del Módulo 1 (USD/m² por barrio, plusvalía). */
  async generateDraft(opts: {
    platform: SocialPlatform;
    goal: ContentGoal;
    propertyId?: string;
    scheduleAuto?: boolean;
  }): Promise<SocialPost> {
    const property = opts.propertyId ? await this.properties.findOneOrFail({ where: { id: opts.propertyId } }) : undefined;
    const market = await this.avo.avgPricePerM2ByNeighborhood();
    const hood = property ? market.find((m) => m.neighborhood === property.neighborhood) : undefined;

    const dataBlock = [
      property
        ? `PROPIEDAD: ${property.title}, ${property.type} en ${property.neighborhood}. USD ${property.priceUsd}, ${property.coveredM2} m², ${property.rooms} ambientes.`
        : '',
      hood ? `VALOR M² EN ${hood.neighborhood.toUpperCase()}: USD ${hood.avgUsdM2} promedio (${hood.listings} publicaciones activas).` : '',
      `RANKING DE BARRIOS POR USD/M²:\n` +
        [...market].sort((a, b) => a.avgUsdM2 - b.avgUsdM2).slice(0, 8).map((m) => `- ${m.neighborhood}: USD ${m.avgUsdM2}/m²`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n');

    const goalText =
      opts.goal === 'oportunidad_inversion'
        ? 'Armá una pieza que analice la oportunidad de inversión según el valor del m² por barrio, destacando dónde conviene comprar hoy. Usá SOLO los números provistos.'
        : 'Armá una pieza que destaque esta propiedad y sus ventajas frente al valor del m² de la zona.';

    const parsed = await this.llm.json<{ copy: string; script: string; hashtags: string[] }>(
      BASE_SYSTEM + ' Para TikTok, "script" es el guion; para las demás redes dejalo vacío.',
      `${PLATFORM_GUIDE[opts.platform]}\n\n${goalText}\n\nDATOS:\n${dataBlock}`,
      {
        type: 'object',
        properties: { copy: { type: 'string' }, script: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } },
        required: ['copy', 'script', 'hashtags'],
        additionalProperties: false,
      },
    );

    const post = this.posts.create({
      property,
      platform: opts.platform,
      format: opts.platform === 'tiktok' ? PostFormat.REEL : PostFormat.IMAGEN,
      copy: parsed.copy,
      script: parsed.script || undefined,
      hashtags: cleanHashtags(parsed.hashtags),
      mediaUrls: property?.photoUrls?.slice(0, 5) ?? [],
      status: PostStatus.BORRADOR,
    });

    if (opts.scheduleAuto) {
      post.scheduledAt = await this.nextBestSlot(opts.platform);
      post.status = PostStatus.PROGRAMADO;
    }
    return this.posts.save(post);
  }

  /** Próxima fecha futura que coincide con el mejor día/hora histórico de la plataforma. */
  async nextBestSlot(platform: SocialPlatform): Promise<Date> {
    const [best] = await this.optimizer.bestSlots(platform, 1);
    const now = new Date();
    for (let d = 0; d < 8; d++) {
      // Argentina es UTC-3 todo el año: hora local = UTC - 3
      const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, best.hour + 3, 0, 0));
      const localDow = new Date(candidate.getTime() - 3 * 3600_000).getUTCDay();
      if (localDow === best.dow && candidate > now) return candidate;
    }
    return new Date(now.getTime() + 3600_000);
  }
}

/** Datos de la propiedad para el prompt (sin dirección exacta). */
function describeProperty(p: Property): string {
  return [
    `Título: ${p.title}`,
    `Operación: ${p.operation} · Tipo: ${p.type}`,
    `Zona: ${p.neighborhood}, ${p.city}`,
    `Precio: USD ${p.priceUsd}`,
    `Superficie: ${p.coveredM2} m² cubiertos, ${p.totalM2} m² totales`,
    [p.rooms && `${p.rooms} ambientes`, p.bedrooms && `${p.bedrooms} dormitorios`, p.bathrooms && `${p.bathrooms} baños`, p.garageSpots && `${p.garageSpots} cochera(s)`]
      .filter(Boolean)
      .join(', '),
    p.ageYears != null ? `Antigüedad: ${p.ageYears === 0 ? 'a estrenar' : `${p.ageYears} años`}` : '',
    p.amenities?.length ? `Comodidades: ${p.amenities.join(', ')}` : '',
    p.description?.trim() ? `Descripción cargada por la inmobiliaria: ${p.description.trim().slice(0, 1500)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** "#Villa Gálvez" -> "VillaGalvez"; sin repetidos, hasta 15. */
function cleanHashtags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const tag = t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9ñÑ_]/g, '');
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 15);
}
