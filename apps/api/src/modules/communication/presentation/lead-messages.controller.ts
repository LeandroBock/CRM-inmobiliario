import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
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

@Controller('leads/:id/messages')
export class LeadMessagesController {
  constructor(private readonly conversation: ConversationService) {}

  /** Envía un WhatsApp al lead en nombre del asesor logueado y pausa al asistente. */
  @Post()
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AgentMessageDto, @CurrentUser() user: AuthUser) {
    return this.conversation.sendAgentMessage(id, dto.text, user.id);
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
