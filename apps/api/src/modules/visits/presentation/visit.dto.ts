import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { VisitStatus } from '../domain/visit.enums';

export class CreateVisitDto {
  @IsUUID() leadId: string;
  @IsUUID() propertyId: string;
  /** ISO 8601 con zona: "2026-10-15T17:00:00-03:00" */
  @Type(() => Date) @IsDate({ message: 'startAt tiene que ser una fecha ISO válida' }) startAt: Date;
  @IsOptional() @IsInt() @Min(15) @Max(240) durationMin?: number;
  @IsOptional() @IsEnum(VisitStatus) status?: VisitStatus;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateVisitDto {
  @IsOptional() @Type(() => Date) @IsDate({ message: 'startAt tiene que ser una fecha ISO válida' }) startAt?: Date;
  @IsOptional() @IsInt() @Min(15) @Max(240) durationMin?: number;
  @IsOptional() @IsEnum(VisitStatus) status?: VisitStatus;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class VisitQuery {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsEnum(VisitStatus) status?: VisitStatus;
  /** true = solo visitas de leads a cargo del usuario logueado. */
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() mine?: boolean;
  /** Lo completa el controller (no viene del cliente). */
  currentUserId?: string;
}
