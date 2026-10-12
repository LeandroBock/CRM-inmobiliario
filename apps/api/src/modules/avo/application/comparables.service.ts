import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Property } from '../../properties/domain/property.entity';
import { OperationType, PropertyStatus, PropertyType } from '../../properties/domain/property.enums';
import { ComparablesEstimate, estimateFromComparables } from '../domain/comparables-estimate';

export interface ComparablesInput {
  propertyId?: string;
  type?: PropertyType;
  operation?: OperationType;
  neighborhood?: string;
  city?: string;
  coveredM2?: number;
  lat?: number;
  lng?: number;
}

export interface Comparable {
  id: string;
  title: string;
  neighborhood: string;
  status: PropertyStatus;
  coveredM2: number;
  priceUsd: number;
  pricePerM2Usd: number;
  /** Metros a la propiedad tasada (solo si las dos tienen ubicación). */
  distanceM: number | null;
  /** Se descartó por ser un valor extremo. */
  outlier: boolean;
}

export interface ComparablesResult {
  method: 'comparables';
  target: { type: PropertyType; operation: OperationType; coveredM2: number; neighborhood: string | null; city: string | null };
  /** Cómo se eligieron las comparables, en palabras. */
  criteria: string;
  estimate: ComparablesEstimate | null;
  comparables: Comparable[];
  /** Aviso para el asesor (pocas comparables, búsqueda ampliada...). */
  warning: string | null;
}

/** Solo publicaciones de los últimos 2 años: precios más viejos ya no representan el mercado. */
const MAX_AGE_MONTHS = 24;
/** Con estas comparables ya no se amplía la búsqueda. */
const ENOUGH = 5;
const SHOWN = 15;

const TYPE_NAMES: Record<PropertyType, [singular: string, plural: string]> = {
  [PropertyType.DEPARTAMENTO]: ['departamento', 'departamentos'],
  [PropertyType.CASA]: ['casa', 'casas'],
  [PropertyType.PH]: ['PH', 'PH'],
  [PropertyType.TERRENO]: ['terreno', 'terrenos'],
  [PropertyType.LOCAL]: ['local', 'locales'],
  [PropertyType.OFICINA]: ['oficina', 'oficinas'],
  [PropertyType.COCHERA]: ['cochera', 'cocheras'],
};

interface Stage {
  label: string;
  radiusM?: number;
  sameNeighborhood?: boolean;
  sameCity?: boolean;
  /** Superficie aceptada, como fracción de la de la propiedad tasada. */
  size: [number, number];
}

/** De lo más parecido a lo más amplio: se usa la primera etapa que junta suficientes comparables. */
const STAGES_WITH_LOCATION: Stage[] = [
  { label: 'a menos de 1 km', radiusM: 1000, size: [0.7, 1.4] },
  { label: 'a menos de 2 km', radiusM: 2000, size: [0.7, 1.4] },
  { label: 'a menos de 3 km', radiusM: 3000, size: [0.6, 1.6] },
  { label: 'a menos de 5 km', radiusM: 5000, size: [0.5, 2] },
];
const STAGES_BY_NEIGHBORHOOD: Stage[] = [
  { label: 'en el mismo barrio', sameNeighborhood: true, size: [0.7, 1.4] },
  { label: 'en el mismo barrio', sameNeighborhood: true, size: [0.5, 2] },
  { label: 'en la misma ciudad', sameCity: true, size: [0.7, 1.4] },
];

/**
 * Tasación por comparables con el inventario propio: mismo tipo y operación, superficie parecida, cerca (o en el
 * mismo barrio). No necesita modelo ni datos externos; mejora a medida que se cargan propiedades.
 */
@Injectable()
export class ComparablesService {
  constructor(@InjectRepository(Property) private readonly properties: Repository<Property>) {}

  async appraise(input: ComparablesInput): Promise<ComparablesResult> {
    const base = input.propertyId ? await this.properties.findOne({ where: { id: input.propertyId } }) : null;
    if (input.propertyId && !base) throw new NotFoundException('Propiedad no encontrada');

    // Lo que viene en el pedido gana sobre lo guardado (sirve para "¿y si tuviera 80 m²?").
    const type = input.type ?? base?.type;
    const operation = input.operation ?? base?.operation ?? OperationType.VENTA;
    const coveredM2 = Number(input.coveredM2 ?? base?.coveredM2);
    const neighborhood = (input.neighborhood ?? base?.neighborhood)?.trim() || null;
    const city = (input.city ?? base?.city)?.trim() || null;
    const lat = input.lat ?? base?.location?.coordinates[1];
    const lng = input.lng ?? base?.location?.coordinates[0];
    if (!type) throw new BadRequestException('Indicá el tipo de propiedad');
    if (!(coveredM2 > 0)) throw new BadRequestException('Indicá la superficie cubierta');
    const hasLocation = lat !== undefined && lng !== undefined && lat !== null && lng !== null;
    if (!hasLocation && !neighborhood && !city) throw new BadRequestException('Indicá la ubicación (latitud y longitud) o al menos el barrio');

    const stages = [
      ...(hasLocation ? STAGES_WITH_LOCATION : []),
      ...STAGES_BY_NEIGHBORHOOD.filter((s) => (s.sameNeighborhood ? neighborhood : city)),
    ];

    let best: { stage: Stage; rows: Comparable[] } | null = null;
    for (const stage of stages) {
      const rows = await this.find(stage, { type, operation, coveredM2, neighborhood, city, lat, lng, excludeId: base?.id });
      if (!best || rows.length > best.rows.length) best = { stage, rows };
      if (rows.length >= ENOUGH) break;
    }
    const rows = best?.rows ?? [];
    const estimate = estimateFromComparables(coveredM2, rows.map((r) => r.pricePerM2Usd));
    const outliers = new Set(estimate?.outliers ?? []);
    const comparables = rows.map((r, i) => ({ ...r, outlier: outliers.has(i) })).slice(0, SHOWN);

    const [one, many] = TYPE_NAMES[type] ?? [type, type];
    const criteria = best
      ? `${rows.length} ${rows.length === 1 ? one : many} en ${operation}, ${best.stage.label}, de ` +
        `${Math.round(coveredM2 * best.stage.size[0])} a ${Math.round(coveredM2 * best.stage.size[1])} m² cubiertos, ` +
        `publicadas en los últimos ${MAX_AGE_MONTHS} meses`
      : 'Sin criterios de búsqueda';

    let warning: string | null = null;
    if (!estimate) {
      warning =
        `Hay ${rows.length === 0 ? 'ninguna propiedad comparable' : `solo ${rows.length} propiedad${rows.length === 1 ? '' : 'es'} comparable${rows.length === 1 ? '' : 's'}`} ` +
        'cargada en el CRM: hacen falta al menos 3 para estimar. Se puede tasar mejor a medida que se carguen más propiedades de la zona.';
    } else if (estimate.confidence === 'baja') {
      warning = 'Pocas comparables o precios muy distintos entre sí: tomalo como una referencia, no como un valor firme.';
    } else if (best && best.stage !== stages[0]) {
      warning = `No había suficientes comparables muy cerca: se amplió la búsqueda (${best.stage.label}).`;
    }

    return { method: 'comparables', target: { type, operation, coveredM2, neighborhood, city }, criteria, estimate, comparables, warning };
  }

  private async find(
    stage: Stage,
    t: { type: PropertyType; operation: OperationType; coveredM2: number; neighborhood: string | null; city: string | null; lat?: number; lng?: number; excludeId?: string },
  ): Promise<Comparable[]> {
    const qb = this.properties
      .createQueryBuilder('p')
      .select(['p.id', 'p.title', 'p.neighborhood', 'p.status', 'p.coveredM2', 'p.priceUsd'])
      .where('p.type = :type AND p.operation = :operation', { type: t.type, operation: t.operation })
      .andWhere('p.status <> :paused', { paused: PropertyStatus.PAUSADA })
      .andWhere('p.price_usd > 0 AND p.covered_m2 BETWEEN :min AND :max', { min: t.coveredM2 * stage.size[0], max: t.coveredM2 * stage.size[1] })
      .andWhere(`p.updated_at > now() - interval '${MAX_AGE_MONTHS} months'`);
    if (t.excludeId) qb.andWhere('p.id <> :excludeId', { excludeId: t.excludeId });

    const hasPoint = t.lat !== undefined && t.lng !== undefined;
    const point = 'ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography';
    if (hasPoint) {
      qb.setParameters({ lat: t.lat, lng: t.lng }).addSelect(`ST_Distance(p.location, ${point})`, 'distance');
    }
    if (stage.radiusM) qb.andWhere(`ST_DWithin(p.location, ${point}, :radius)`, { radius: stage.radiusM });
    if (stage.sameNeighborhood) qb.andWhere('lower(p.neighborhood) = lower(:hood)', { hood: t.neighborhood });
    if (stage.sameCity) qb.andWhere('lower(p.city) = lower(:city)', { city: t.city });
    // Primero las más cercanas; sin ubicación, las de superficie más parecida.
    if (hasPoint) qb.orderBy('distance', 'ASC', 'NULLS LAST');
    else qb.orderBy('abs(p.covered_m2 - :area)', 'ASC').setParameter('area', t.coveredM2);
    qb.limit(60);

    const { entities, raw } = await qb.getRawAndEntities<{ distance: string | null }>();
    return entities.map((p, i) => ({
      id: p.id,
      title: p.title,
      neighborhood: p.neighborhood,
      status: p.status,
      coveredM2: p.coveredM2,
      priceUsd: p.priceUsd,
      pricePerM2Usd: Math.round(p.priceUsd / p.coveredM2),
      distanceM: raw[i]?.distance != null ? Math.round(Number(raw[i].distance)) : null,
      outlier: false,
    }));
  }
}
