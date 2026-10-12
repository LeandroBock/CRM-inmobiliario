import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PropertiesService } from '../application/properties.service';
import { CreatePropertyDto, PropertyQuery, UpdatePropertyDto } from './property.dto';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Post()
  create(@Body() dto: CreatePropertyDto) {
    return this.properties.create(dto);
  }

  /** Filtros: status, type, operation, neighborhood, minPriceUsd, maxPriceUsd, minRooms, q, lat+lng+radiusM */
  @Get()
  findAll(@Query() query: PropertyQuery) {
    return this.properties.findAll(query);
  }

  /** Recalcula los precios en pesos con la cotización de hoy (también corre solo cada día hábil). */
  @Post('refresh-fx')
  @HttpCode(200)
  refreshFx() {
    return this.properties.refreshArsPrices();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.properties.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePropertyDto) {
    return this.properties.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.properties.remove(id);
  }
}
