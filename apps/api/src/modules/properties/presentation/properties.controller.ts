import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MAX_SHEET_PHOTOS, PropertySheetService } from '../application/property-sheet.service';
import { PhotosZipService } from '../application/photos-zip.service';
import { PropertiesService } from '../application/properties.service';
import { CreatePropertyDto, PropertyQuery, UpdatePropertyDto } from './property.dto';

const URL_OPTS = { require_tld: false, require_protocol: true, protocols: ['http', 'https'] };

class SheetDto {
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SHEET_PHOTOS) @IsUrl(URL_OPTS, { each: true }) photoUrls?: string[];
  @IsOptional() @IsString() @MaxLength(80) agencyName?: string;
  @IsOptional() @IsString() @MaxLength(120) contact?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) brandColor?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl(URL_OPTS) logoUrl?: string | null;
  @IsOptional() @IsBoolean() showAddress?: boolean;
  @IsOptional() @IsBoolean() showPrice?: boolean;
  @IsOptional() @IsBoolean() showArs?: boolean;
}

@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly sheets: PropertySheetService,
    private readonly photosZip: PhotosZipService,
  ) {}

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

  /** Ficha en PDF para mandar por WhatsApp o imprimir. POST porque lleva opciones (fotos, marca, qué mostrar). */
  @Post(':id/sheet')
  @HttpCode(200)
  async sheet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SheetDto) {
    const { pdf, fileName } = await this.sheets.build(id, dto);
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `attachment; filename="${fileName}"` });
  }

  /** Las fotos en un ZIP, numeradas en orden, para cargarlas en Zonaprop, Argenprop, MercadoLibre... */
  @Get(':id/photos.zip')
  async photosZipFile(@Param('id', ParseUUIDPipe) id: string) {
    const { zip, fileName } = await this.photosZip.build(id);
    return new StreamableFile(zip, { type: 'application/zip', disposition: `attachment; filename="${fileName}"` });
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
