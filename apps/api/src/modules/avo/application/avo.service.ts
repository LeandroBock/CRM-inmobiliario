import { HttpService } from '@nestjs/axios';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom, timeout } from 'rxjs';
import { Repository } from 'typeorm';
import { Property } from '../../properties/domain/property.entity';
import { AvoPrediction } from '../domain/avo-prediction.entity';
import { AvoRequestDto } from '../presentation/avo-request.dto';
import { requiredSetting } from '../../../shared/infrastructure/required-setting';

/** Contrato con el microservicio Python (FastAPI + XGBoost). Todo en USD. */
interface AvmServiceResponse {
  estimated_price_usd: number;
  range_low_usd: number;
  range_high_usd: number;
  projected_price_3y_usd: number;
  appreciation_3y_pct: number;
  confidence: number;
  model_version: string;
}

@Injectable()
export class AvoService {
  private readonly logger = new Logger(AvoService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(AvoPrediction) private readonly predictions: Repository<AvoPrediction>,
    @InjectRepository(Property) private readonly properties: Repository<Property>,
  ) {}

  /** Opcional: sin el servicio de tasación, la API arranca igual y solo falla la tasación (con un mensaje claro). */
  private get baseUrl(): string {
    return requiredSetting(this.config, 'AVM_SERVICE_URL').replace(/\/+$/, '');
  }

  async appraise(dto: AvoRequestDto): Promise<AvoPrediction> {
    const property = dto.propertyId
      ? await this.properties.findOneOrFail({ where: { id: dto.propertyId } })
      : undefined;

    // Si viene propertyId, los datos de la propiedad completan lo que falte en el DTO.
    const features = {
      neighborhood: dto.neighborhood ?? property?.neighborhood,
      city: dto.city ?? property?.city,
      property_type: dto.type ?? property?.type,
      covered_m2: dto.coveredM2 ?? property?.coveredM2,
      total_m2: dto.totalM2 ?? property?.totalM2,
      rooms: dto.rooms ?? property?.rooms,
      bathrooms: dto.bathrooms ?? property?.bathrooms,
      garage_spots: dto.garageSpots ?? property?.garageSpots ?? 0,
      age_years: dto.ageYears ?? property?.ageYears ?? null,
      lat: dto.lat ?? property?.location?.coordinates[1] ?? null,
      lng: dto.lng ?? property?.location?.coordinates[0] ?? null,
      amenities: dto.amenities ?? property?.amenities ?? [],
    };

    let result: AvmServiceResponse;
    const url = `${this.baseUrl}/predict`; // antes del try: si falta configurarlo, ese es el mensaje
    try {
      const res = await firstValueFrom(
        this.http.post<AvmServiceResponse>(url, features).pipe(timeout(15_000)),
      );
      result = res.data;
    } catch (err) {
      this.logger.error(`Fallo el servicio de tasación: ${(err as Error).message}`);
      throw new BadGatewayException('El servicio de tasación no está disponible, probá de nuevo en unos minutos.');
    }

    const area = Number(features.covered_m2) || 1;
    const prediction = this.predictions.create({
      property,
      estimatedPriceUsd: result.estimated_price_usd,
      pricePerM2Usd: Math.round((result.estimated_price_usd / area) * 100) / 100,
      rangeLowUsd: result.range_low_usd,
      rangeHighUsd: result.range_high_usd,
      projectedPrice3yUsd: result.projected_price_3y_usd,
      appreciation3yPct: result.appreciation_3y_pct,
      confidence: result.confidence,
      modelVersion: result.model_version,
      inputFeatures: features,
    });
    return this.predictions.save(prediction);
  }

  history(propertyId: string) {
    return this.predictions.find({ where: { property: { id: propertyId } }, order: { createdAt: 'DESC' } });
  }

  /** Valor promedio del m2 (USD) por barrio, usado como insumo del SocialMediaModule. */
  async avgPricePerM2ByNeighborhood(): Promise<{ neighborhood: string; avgUsdM2: number; listings: number }[]> {
    const rows = await this.properties
      .createQueryBuilder('p')
      .select('p.neighborhood', 'neighborhood')
      .addSelect('AVG(p.price_usd / NULLIF(p.covered_m2, 0))', 'avg')
      .addSelect('COUNT(*)', 'listings')
      .where('p.status = :s', { s: 'disponible' })
      .groupBy('p.neighborhood')
      .getRawMany();
    return rows.map((r) => ({
      neighborhood: r.neighborhood,
      avgUsdM2: Math.round(parseFloat(r.avg)),
      listings: Number(r.listings),
    }));
  }
}
