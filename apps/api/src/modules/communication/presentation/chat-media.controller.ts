import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { ChatHistory } from '../domain/chat-history.entity';
import { ChatMediaStorage } from '../infrastructure/chat-media.storage';

/** Audios y fotos de los clientes. Requiere sesión (no hay URL pública); la web los pide con el token. */
@Controller('chat-media')
export class ChatMediaController {
  constructor(
    @InjectRepository(ChatHistory) private readonly chats: Repository<ChatHistory>,
    private readonly storage: ChatMediaStorage,
  ) {}

  @Get(':messageId')
  async get(@Param('messageId', ParseUUIDPipe) messageId: string, @Res() res: Response) {
    const chat = await this.chats.findOne({ select: { id: true, mediaFile: true, mediaMime: true }, where: { id: messageId } });
    if (!chat?.mediaFile) throw new NotFoundException('El mensaje no tiene adjunto');
    let data: Buffer;
    try {
      data = await this.storage.read(chat.mediaFile);
    } catch {
      throw new NotFoundException('El archivo ya no está disponible');
    }
    res.set({
      'Content-Type': chat.mediaMime?.split(';')[0] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.send(data);
  }
}
