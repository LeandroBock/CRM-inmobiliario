import { IsArray, IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { OperationType, PropertyType } from '../../properties/domain/property.enums';

export class AvoRequestDto {
  /** Si se envía, se completan los datos desde la propiedad guardada. */
  @IsOptional() @IsUUID() propertyId?: string;

  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsEnum(PropertyType) type?: PropertyType;
  @IsOptional() @IsNumber() @Min(1) coveredM2?: number;
  @IsOptional() @IsNumber() @Min(1) totalM2?: number;
  @IsOptional() @IsNumber() @Min(0) rooms?: number;
  @IsOptional() @IsNumber() @Min(0) bathrooms?: number;
  @IsOptional() @IsNumber() @Min(0) garageSpots?: number;
  @IsOptional() @IsNumber() @Min(0) ageYears?: number;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsArray() amenities?: string[];
}

/** Tasación por comparables. Con propertyId se toman sus datos; lo que se mande además, los pisa. */
export class ComparablesRequestDto {
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsEnum(PropertyType) type?: PropertyType;
  @IsOptional() @IsEnum(OperationType) operation?: OperationType;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsNumber() @Min(1) coveredM2?: number;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}
