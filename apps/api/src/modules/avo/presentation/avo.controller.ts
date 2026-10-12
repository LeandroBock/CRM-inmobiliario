import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AvoService } from '../application/avo.service';
import { AvoRequestDto } from './avo-request.dto';

@Controller('avo')
export class AvoController {
  constructor(private readonly avo: AvoService) {}

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
