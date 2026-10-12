import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ChatHistory } from '../domain/chat-history.entity';
import { ChatMediaStorage } from '../infrastructure/chat-media.storage';

/** Margen para no borrar un archivo que se guardó pero cuyo mensaje todavía no llegó a la base. */
const GRACE_MS = 60 * 60 * 1000;

/**
 * Al borrar un lead, sus mensajes se van en cascada pero los archivos quedan en disco.
 * Cada noche se borran los audios y fotos que ya no tienen mensaje (son datos personales: no se guardan de más).
 */
@Injectable()
export class ChatMediaCleanupService {
  private readonly logger = new Logger(ChatMediaCleanupService.name);

  constructor(
    @InjectRepository(ChatHistory) private readonly chats: Repository<ChatHistory>,
    private readonly storage: ChatMediaStorage,
  ) {}

  @Cron('45 3 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async scheduled(): Promise<void> {
    try {
      const deleted = await this.cleanup();
      if (deleted) this.logger.log(`Adjuntos de chat huérfanos borrados: ${deleted}`);
    } catch (err) {
      this.logger.error(`Falló la limpieza de adjuntos de chat: ${(err as Error).message}`);
    }
  }

  async cleanup(now = new Date()): Promise<number> {
    const files = await this.storage.list();
    const rows = await this.chats.find({ select: { mediaFile: true }, where: { mediaFile: Not(IsNull()) } });
    const referenced = new Set(rows.map((r) => r.mediaFile));
    const orphans = files.filter((f) => !referenced.has(f.fileName) && f.createdAt.getTime() < now.getTime() - GRACE_MS);
    for (const f of orphans) await this.storage.remove(f.fileName);
    return orphans.length;
  }
}
