import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../shared/domain/pagination';
import { OperationType, PropertyType } from '../../properties/domain/property.enums';
import { LeadStage, LeadTemperature } from '../domain/lead.entity';

/** leadScore, temperature y urgency NO se editan a mano: los calcula el LeadEngine y el chat con IA. */
export class CreateLeadDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  /** Acepta formatos locales ("341 555-1234", "0341 15 555-1234"); se guarda en E.164 (+549...). */
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() email?: string;
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;

  @IsOptional() @IsNumber() @Min(0) budgetMinUsd?: number;
  @IsOptional() @IsNumber() @Min(0) budgetMaxUsd?: number;
  @IsOptional() @IsEnum(OperationType) wantsOperation?: OperationType;
  @IsOptional() @IsArray() @IsEnum(PropertyType, { each: true }) wantedTypes?: PropertyType[];
  @IsOptional() @IsArray() @IsString({ each: true }) preferredNeighborhoods?: string[];
  @IsOptional() @IsInt() @Min(0) minRooms?: number;
  @IsOptional() @IsBoolean() needsGarage?: boolean;
  @IsOptional() @IsBoolean() hasMortgageApproval?: boolean;
  /** Pausa (true) o reactiva (false) al asistente de WhatsApp para este lead. */
  @IsOptional() @IsBoolean() aiPaused?: boolean;
}

/** Al crear se puede elegir el asesor; si no, queda a cargo de quien lo carga. Para cambiarlo: PATCH /leads/:id/assign. */
export class CreateLeadWithAssigneeDto extends CreateLeadDto {
  @IsOptional() @IsUUID() assignedUserId?: string;
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class AssignLeadDto {
  /** null = sin asignar */
  @IsOptional() @IsUUID() userId: string | null;
}

export class LeadQuery extends PaginationQuery {
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @IsEnum(LeadTemperature) temperature?: LeadTemperature;
  @IsOptional() @IsString() q?: string; // nombre, teléfono o email
  /** "me" (mis leads), "none" (sin asignar) o el id de un asesor. */
  @IsOptional() @IsString() assignedTo?: string;
  /** Lo completa el controller con el usuario logueado (no viene del cliente). */
  currentUserId?: string;
}
