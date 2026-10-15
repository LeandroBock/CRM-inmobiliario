import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { AuthUser } from '../../auth/domain/auth.types';
import { UserRole } from '../../auth/domain/user-role.enum';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { IndexService } from '../application/index.service';
import { RentalsService } from '../application/rentals.service';
import { AdjustmentIndex, ContractStatus, IndexCode, RentCurrency } from '../domain/rental.enums';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const emptyToNull = () => Transform(({ value }) => (typeof value === 'string' && !value.trim() ? null : typeof value === 'string' ? value.trim() : value));

class ContractDto {
  @IsUUID() propertyId: string;
  @trim() @IsString() @IsNotEmpty({ message: 'Falta el nombre del inquilino' }) @MaxLength(120) tenantName: string;
  @emptyToNull() @IsOptional() @IsString() @MaxLength(40) tenantPhone?: string | null;
  @emptyToNull() @IsOptional() @ValidateIf((_, v) => v !== null) @IsEmail({}, { message: 'El email del inquilino no es válido' }) tenantEmail?: string | null;
  @emptyToNull() @IsOptional() @IsString() @MaxLength(20) tenantDocument?: string | null;
  @trim() @IsString() @IsNotEmpty({ message: 'Falta el nombre del propietario' }) @MaxLength(120) ownerName: string;
  @emptyToNull() @IsOptional() @IsString() @MaxLength(40) ownerPhone?: string | null;
  @emptyToNull() @IsOptional() @ValidateIf((_, v) => v !== null) @IsEmail({}, { message: 'El email del propietario no es válido' }) ownerEmail?: string | null;
  @IsDateString({ strict: true }, { message: 'Fecha de inicio inválida' }) startDate: string;
  @IsDateString({ strict: true }, { message: 'Fecha de fin inválida' }) endDate: string;
  @IsOptional() @IsEnum(RentCurrency) currency?: RentCurrency;
  @Type(() => Number) @IsNumber() @IsPositive({ message: 'El alquiler tiene que ser mayor a cero' }) initialRent: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28, { message: 'El día de pago va del 1 al 28' }) paymentDueDay?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(0) deposit?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(0) @Max(100) adminFeePct?: number | null;
  @IsEnum(AdjustmentIndex) adjustmentIndex: AdjustmentIndex;
  @Type(() => Number) @IsInt() @Min(1) @Max(36) adjustmentEveryMonths: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(0) @Max(1000) fixedRatePct?: number | null;
  @emptyToNull() @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

class CreateContractDto extends ContractDto {
  /** Contrato que ya venía de antes: los meses hasta esta fecha se cargan como pagos. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) paidThrough?: string | null;
}

class UpdateContractDto extends PartialType(ContractDto) {
  @IsOptional() @IsEnum(ContractStatus) status?: ContractStatus;
}

class ListQuery {
  @IsOptional() @IsEnum(ContractStatus) status?: ContractStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class ApplyAdjustmentDto {
  /** Opcional: monto editado a mano (si no, el calculado con el índice). */
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive() newRent?: number;
}

class PaymentDto {
  @IsDateString({ strict: true }, { message: 'Mes inválido' }) period: string;
  @Type(() => Number) @IsNumber() @IsPositive({ message: 'El monto tiene que ser mayor a cero' }) amount: number;
  @IsDateString({ strict: true }, { message: 'Fecha de pago inválida' }) paidAt: string;
  @emptyToNull() @IsOptional() @IsString() @MaxLength(40) method?: string | null;
  @emptyToNull() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

class IndexValueDto {
  @IsIn([IndexCode.ICL, IndexCode.IPC]) index: IndexCode;
  @IsDateString({ strict: true }) date: string;
  @Type(() => Number) @IsNumber() @IsPositive() value: number;
}

@Controller('rentals')
export class RentalsController {
  constructor(
    private readonly rentals: RentalsService,
    private readonly indexes: IndexService,
  ) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.rentals.list(q);
  }

  /** Últimos valores de ICL e IPC (para mostrar de dónde sale cada ajuste). */
  @Get('indexes')
  async recentIndexes() {
    const [icl, ipc] = await Promise.all([this.indexes.recent(IndexCode.ICL, 5), this.indexes.recent(IndexCode.IPC, 6)]);
    return { icl, ipc };
  }

  /** Carga a mano un valor (p. ej. el IPC que el INDEC publicó y la API todavía no tiene). */
  @Post('indexes')
  @Roles(UserRole.ADMIN)
  setIndex(@Body() dto: IndexValueDto) {
    return this.indexes.setManual(dto.index, dto.date, dto.value);
  }

  /** Descarga ya los índices (también corre solo todos los días a las 8:30). */
  @Post('indexes/sync')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  syncIndexes() {
    return this.indexes.sync();
  }

  @Post()
  create(@Body() dto: CreateContractDto, @CurrentUser() user: AuthUser) {
    return this.rentals.create(dto, user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rentals.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto) {
    return this.rentals.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.rentals.remove(id);
  }

  @Post(':id/adjustments')
  applyAdjustment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.rentals.applyAdjustment(id, dto.newRent, user.id);
  }

  @Delete(':id/adjustments/last')
  @HttpCode(204)
  async undoAdjustment(@Param('id', ParseUUIDPipe) id: string) {
    await this.rentals.undoLastAdjustment(id);
  }

  @Post(':id/payments')
  addPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto, @CurrentUser() user: AuthUser) {
    return this.rentals.addPayment(id, dto, user.id);
  }

  @Delete(':id/payments/:paymentId')
  @HttpCode(204)
  async removePayment(@Param('id', ParseUUIDPipe) id: string, @Param('paymentId', ParseUUIDPipe) paymentId: string) {
    await this.rentals.removePayment(id, paymentId);
  }
}
