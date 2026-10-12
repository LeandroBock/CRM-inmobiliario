import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/domain/pagination';
import { FxSource, OperationType, PropertyStatus, PropertyType } from '../domain/property.enums';

export class CreatePropertyDto {
  @IsString() @MinLength(3) title: string;
  @IsOptional() @IsString() description?: string;

  @IsEnum(PropertyType) type: PropertyType;
  @IsOptional() @IsEnum(OperationType) operation?: OperationType;
  @IsOptional() @IsEnum(PropertyStatus) status?: PropertyStatus;

  @IsString() address: string;
  @IsString() neighborhood: string;
  @IsString() city: string;
  @IsString() province: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;

  @IsNumber() @Min(0) coveredM2: number;
  @IsNumber() @Min(0) totalM2: number;
  @IsOptional() @IsInt() @Min(0) rooms?: number;
  @IsOptional() @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @IsInt() @Min(0) bathrooms?: number;
  @IsOptional() @IsInt() @Min(0) garageSpots?: number;
  @IsOptional() @IsInt() @Min(0) ageYears?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  /** Links externos o URLs devueltas por POST /media/photos. El orden importa: la primera es la portada. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }, { each: true })
  photoUrls?: string[];

  /**
   * Precio: enviar priceUsd (fuente de verdad) o priceArs (se convierte a USD con la cotización).
   * Si se envían ambos, manda priceUsd.
   */
  @IsOptional() @IsNumber() @Min(0) priceUsd?: number;
  @IsOptional() @IsNumber() @Min(0) priceArs?: number;

  /** Cotización a usar. Si se omite se consulta la del día según fxSource (por defecto: blue). */
  @IsOptional() @IsNumber() @Min(1) fxRate?: number;
  @IsOptional() @IsEnum(FxSource) fxSource?: FxSource;
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class PropertyQuery extends PaginationQuery {
  @IsOptional() @IsEnum(PropertyStatus) status?: PropertyStatus;
  @IsOptional() @IsEnum(PropertyType) type?: PropertyType;
  @IsOptional() @IsEnum(OperationType) operation?: OperationType;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @Type(() => Number) @IsNumber() minPriceUsd?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxPriceUsd?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minRooms?: number;
  @IsOptional() @IsString() q?: string; // texto libre sobre título/dirección

  // Búsqueda por cercanía (PostGIS): lat + lng + radio en metros
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(50_000) radiusM?: number;
}
