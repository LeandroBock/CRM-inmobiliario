import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../../auth/domain/auth.types';
import { CurrentUser } from '../../auth/presentation/decorators';
import { VisitsService } from '../application/visits.service';
import { CreateVisitDto, UpdateVisitDto, VisitQuery } from './visit.dto';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /** Filtros: from, to (ISO), leadId, status, mine. Ordenadas por fecha. */
  @Get()
  list(@Query() q: VisitQuery, @CurrentUser() user: AuthUser) {
    return this.visits.list({ ...q, currentUserId: user.id });
  }

  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVisitDto) {
    return this.visits.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.visits.remove(id);
  }
}
