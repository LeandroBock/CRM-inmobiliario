import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AvoService } from '../../avo/application/avo.service';
import { Property } from '../../properties/domain/property.entity';
import { PostFormat, PostStatus, SocialPlatform, SocialPost } from '../domain/social-post.entity';
import { PostingTimeOptimizer } from './posting-time.optimizer';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

export type ContentGoal = 'propiedad' | 'oportunidad_inversion';

const PLATFORM_GUIDE: Record<SocialPlatform, string> = {
  instagram: 'Instagram: copy de hasta 600 caracteres, gancho en la primera línea, 5 a 8 hashtags, emojis moderados.',
  facebook: 'Facebook: copy de 300 a 500 caracteres, tono cercano, una llamada a la acción clara.',
  linkedin: 'LinkedIn: tono profesional y analítico, enfocado en datos de mercado e inversión, sin hashtags excesivos (máximo 3).',
  tiktok: 'TikTok: guion de 20 a 30 segundos con gancho en los primeros 3 segundos, escenas numeradas y texto en pantalla.',
};

@Injectable()
export class ContentService {
  private anthropic?: Anthropic;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    private readonly avo: AvoService,
    private readonly optimizer: PostingTimeOptimizer,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
  ) {
    this.model = config.get('LLM_MODEL', 'claude-sonnet-5-5');
  }

  /** Se crea al primer uso: sin ANTHROPIC_API_KEY la API arranca igual y solo falla esta función. */
  private get client(): Anthropic {
    return (this.anthropic ??= new Anthropic({ apiKey: requiredSetting(this.config, 'ANTHROPIC_API_KEY') }));
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

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 900,
      system:
        'Sos redactor de marketing inmobiliario en Argentina. Escribí en español rioplatense (voseo) con tono profesional y cercano. ' +
        'Expresá siempre los precios en dólares (USD). No inventes cifras ni prometas rentabilidades garantizadas. ' +
        'Devolvé SOLO un JSON con las claves: "copy" (string), "script" (string o null), "hashtags" (array de strings sin #).',
      messages: [{ role: 'user', content: `${PLATFORM_GUIDE[opts.platform]}\n\n${goalText}\n\nDATOS:\n${dataBlock}` }],
    });

    const raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const parsed = this.parseJson(raw);

    const post = this.posts.create({
      property,
      platform: opts.platform,
      format: opts.platform === 'tiktok' ? PostFormat.REEL : PostFormat.IMAGEN,
      copy: parsed.copy,
      script: parsed.script ?? undefined,
      hashtags: parsed.hashtags ?? [],
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

  private parseJson(raw: string): { copy: string; script?: string | null; hashtags?: string[] } {
    const match = raw.match(/\{[\s\S]*\}/);
    try {
      return JSON.parse(match ? match[0] : raw);
    } catch {
      return { copy: raw.trim(), script: null, hashtags: [] }; // si el modelo no devolvió JSON válido, usamos el texto tal cual
    }
  }
}
