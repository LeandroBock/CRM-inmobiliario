import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AvoService } from '../application/avo.service';
import { ComparablesService } from '../application/comparables.service';
import { AvoRequestDto, ComparablesRequestDto } from './avo-request.dto';

@Controller('avo')
export class AvoController {
  constructor(
    private readonly avo: AvoService,
    private readonly comparablesService: ComparablesService,
  ) {}

  /** Tasación por comparables con el inventario del CRM (no necesita el servicio de tasación). */
  @Post('comparables')
  @HttpCode(200)
  comparables(@Body() dto: ComparablesRequestDto) {
    return this.comparablesService.appraise(dto);
  }

  /** POST /avo/appraise  -> tasación en USD + plusvalía a 3 años */
  @Post('appraise')
  appraise(@Body() dto: AvoRequestDto) {
    return this.avo.appraise(dto);
  }

  @Get('properties/:id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.avo.history(id);
  }

  @Get('market/neighborhoods')
  market() {
    return this.avo.avgPricePerM2ByNeighborhood();
  }
}
