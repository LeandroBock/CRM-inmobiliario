import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import type { Point } from 'geojson';
import { Repository } from 'typeorm';
import { definedOnly } from '../../../shared/domain/defined-only';
import { Paginated } from '../../../shared/domain/pagination';
import { CalendarSyncService } from '../../google-calendar/application/calendar-sync.service';
import { FxSource, Property, PropertyStatus } from '../domain/property.entity';
import { CreatePropertyDto, PropertyQuery, UpdatePropertyDto } from '../presentation/property.dto';
import { FxService, todayInArgentina } from './fx.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Pricing {
  priceUsd: number;
  priceArs: number;
  fxRate: number;
  fxSource: FxSource;
  fxRateDate: string;
}

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    @InjectRepository(Property) private readonly repo: Repository<Property>,
    private readonly fx: FxService,
    private readonly calendar: CalendarSyncService,
  ) {}

  async create(dto: CreatePropertyDto): Promise<Property> {
    const { lat, lng, priceUsd, priceArs, fxRate, fxSource, ...rest } = dto;
    const pricing = await this.resolvePricing({ priceUsd, priceArs, fxRate, fxSource });

    const entity = this.repo.create({ ...rest, ...pricing, location: this.toPoint(lat, lng) });
    return this.repo.save(entity);
  }

  async findAll(q: PropertyQuery): Promise<Paginated<Property>> {
    const qb = this.repo.createQueryBuilder('p');

    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.type) qb.andWhere('p.type = :type', { type: q.type });
    if (q.operation) qb.andWhere('p.operation = :operation', { operation: q.operation });
    if (q.neighborhood) qb.andWhere('p.neighborhood ILIKE :hood', { hood: q.neighborhood });
    if (q.minPriceUsd !== undefined) qb.andWhere('p.price_usd >= :minP', { minP: q.minPriceUsd });
    if (q.maxPriceUsd !== undefined) qb.andWhere('p.price_usd <= :maxP', { maxP: q.maxPriceUsd });
    if (q.minRooms !== undefined) qb.andWhere('p.rooms >= :minRooms', { minRooms: q.minRooms });
    if (q.q) qb.andWhere('(p.title ILIKE :text OR p.address ILIKE :text)', { text: `%${q.q}%` });

    if (q.lat !== undefined && q.lng !== undefined) {
      const point = 'ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography';
      qb.andWhere(`ST_DWithin(p.location, ${point}, :radius)`)
        .setParameters({ lat: q.lat, lng: q.lng, radius: q.radiusM ?? 2000 })
        .orderBy(`ST_Distance(p.location, ${point})`, 'ASC');
    } else {
      qb.orderBy('p.created_at', 'DESC');
    }

    const [items, total] = await qb
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .getManyAndCount();
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string): Promise<Property> {
    const property = await this.repo.findOne({ where: { id } });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    return property;
  }

  async update(id: string, dto: UpdatePropertyDto): Promise<Property> {
    const property = await this.findOne(id);
    const { lat, lng, priceUsd, priceArs, fxRate, fxSource, ...rest } = dto;

    Object.assign(property, definedOnly(rest));

    if ((lat === undefined) !== (lng === undefined)) {
      throw new BadRequestException('Para cambiar la ubicación enviá lat y lng juntos');
    }
    if (lat !== undefined && lng !== undefined) property.location = this.toPoint(lat, lng);

    // Si cambia algo del precio o de la cotización, se recalcula todo el bloque bimonetario.
    if ([priceUsd, priceArs, fxRate, fxSource].some((v) => v !== undefined)) {
      Object.assign(property, await this.resolvePricing({ priceUsd, priceArs, fxRate, fxSource }, property));
    }
    return this.repo.save(property);
  }

  async remove(id: string): Promise<void> {
    await this.calendar.removeEvents({ propertyId: id }); // sus visitas se borran en cascada
    const res = await this.repo.delete(id);
    if (!res.affected) throw new NotFoundException('Propiedad no encontrada');
  }

  /**
   * Los precios en pesos se desactualizan con la inflación. Cada día hábil a las 9:00 (hora Argentina)
   * se recalcula priceArs de las propiedades disponibles con la cotización vigente de su fuente.
   */
  @Cron('0 9 * * 1-5', { timeZone: 'America/Argentina/Buenos_Aires' })
  async refreshArsPrices(): Promise<{ source: FxSource; rate: number; updated: number }[]> {
    const result: { source: FxSource; rate: number; updated: number }[] = [];
    for (const source of Object.values(FxSource)) {
      try {
        const { rate, date } = await this.fx.getRate(source);
        const res = await this.repo
          .createQueryBuilder()
          .update(Property)
          .set({ fxRate: rate, fxRateDate: date, priceArs: () => 'ROUND(price_usd * :rate, 2)' })
          .where('fx_source = :source AND status = :status', { source, status: PropertyStatus.DISPONIBLE })
          .setParameter('rate', rate)
          .execute();
        result.push({ source, rate, updated: res.affected ?? 0 });
      } catch (err) {
        this.logger.warn(`Se omite ${source} en el refresco de precios: ${(err as Error).message}`);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- helpers

  private toPoint(lat?: number, lng?: number): Point | undefined {
    if (lat === undefined || lng === undefined) return undefined;
    return { type: 'Point', coordinates: [lng, lat] }; // GeoJSON: [lng, lat]
  }

  /** El USD es la fuente de verdad; el ARS siempre se deriva: priceArs = priceUsd * fxRate. */
  private async resolvePricing(
    input: { priceUsd?: number; priceArs?: number; fxRate?: number; fxSource?: FxSource },
    current?: Property,
  ): Promise<Pricing> {
    const fxSource = input.fxSource ?? current?.fxSource ?? FxSource.BLUE;

    let fxRate = input.fxRate;
    let fxRateDate = todayInArgentina();
    if (!fxRate) {
      const quote = await this.fx.getRate(fxSource);
      fxRate = quote.rate;
      fxRateDate = quote.date;
    }

    let priceUsd = input.priceUsd;
    if (priceUsd === undefined && input.priceArs !== undefined) priceUsd = round2(input.priceArs / fxRate);
    if (priceUsd === undefined) priceUsd = current?.priceUsd;
    if (priceUsd === undefined) throw new BadRequestException('Indicá priceUsd o priceArs');

    return { priceUsd, priceArs: round2(priceUsd * fxRate), fxRate, fxSource, fxRateDate };
  }
}
