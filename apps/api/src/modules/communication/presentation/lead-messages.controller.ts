import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MAX_SHEET_PHOTOS } from '../../properties/application/property-sheet.service';
import { Transform } from 'class-transformer';
import type { AuthUser } from '../../auth/domain/auth.types';
import { CurrentUser } from '../../auth/presentation/decorators';
import { ConversationService } from '../application/conversation.service';

class AgentMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'El mensaje está vacío' })
  @MaxLength(4096) // límite de WhatsApp para mensajes de texto
  text: string;
}

const URL_OPTS = { require_tld: false, require_protocol: true, protocols: ['http', 'https'] };

class SheetMessageDto {
  @IsUUID() propertyId: string;
  /** Texto que acompaña al PDF (WhatsApp lo muestra debajo del archivo). */
  @IsOptional() @IsString() @MaxLength(1024) caption?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SHEET_PHOTOS) @IsUrl(URL_OPTS, { each: true }) photoUrls?: string[];
  @IsOptional() @IsString() @MaxLength(80) agencyName?: string;
  @IsOptional() @IsString() @MaxLength(120) contact?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) brandColor?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl(URL_OPTS) logoUrl?: string | null;
  @IsOptional() @IsBoolean() showAddress?: boolean;
  @IsOptional() @IsBoolean() showPrice?: boolean;
  @IsOptional() @IsBoolean() showArs?: boolean;
}

@Controller('leads/:id/messages')
export class LeadMessagesController {
  constructor(private readonly conversation: ConversationService) {}

  /** Envía un WhatsApp al lead en nombre del asesor logueado y pausa al asistente. */
  @Post()
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AgentMessageDto, @CurrentUser() user: AuthUser) {
    return this.conversation.sendAgentMessage(id, dto.text, user.id);
  }

  /** Manda la ficha PDF de una propiedad por WhatsApp (como documento). */
  @Post('sheet')
  sendSheet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SheetMessageDto, @CurrentUser() user: AuthUser) {
    const { propertyId, caption, ...options } = dto;
    return this.conversation.sendPropertySheet(id, propertyId, options, caption?.trim() || undefined, user.id);
  }

  /** ¿Se le puede escribir texto libre? (ventana de 24 h de WhatsApp) */
  @Get('window')
  window(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversation.windowStatus(id);
  }

  /** Plantilla aprobada para retomar una conversación de hace más de 24 h. */
  @Post('template')
  sendTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.conversation.sendReengageTemplate(id, user.id);
  }
}
