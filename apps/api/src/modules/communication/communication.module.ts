import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { s3Bucket, usesS3 } from '../../shared/infrastructure/storage-config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/domain/user.entity';
import { Lead } from '../leads/domain/lead.entity';
import { Property } from '../properties/domain/property.entity';
import { VisitsModule } from '../visits/visits.module';
import { LeadEngineModule } from '../lead-engine/lead-engine.module';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatMediaCleanupService } from './application/chat-media-cleanup.service';
import { ConversationService } from './application/conversation.service';
import { ChatHistory } from './domain/chat-history.entity';
import { AudioTranscriber } from './infrastructure/audio-transcriber';
import { ChatMediaStorage, LocalChatMediaStorage, S3ChatMediaStorage } from './infrastructure/chat-media.storage';
import { LlmClient } from './infrastructure/llm.client';
import { InventoryRagService } from './infrastructure/rag.service';
import { WhatsAppClient } from './infrastructure/whatsapp.client';
import { ChatMediaController } from './presentation/chat-media.controller';
import { LeadMessagesController } from './presentation/lead-messages.controller';
import { WhatsAppWebhookController } from './presentation/whatsapp.webhook.controller';

@Module({
  imports: [HttpModule, VisitsModule, LeadEngineModule, LeadsModule, NotificationsModule, TypeOrmModule.forFeature([Lead, ChatHistory, Property, User])],
  controllers: [WhatsAppWebhookController, LeadMessagesController, ChatMediaController],
  providers: [
    ConversationService,
    InventoryRagService,
    LlmClient,
    WhatsAppClient,
    AudioTranscriber,
    ChatMediaCleanupService,
    {
      // Audios y fotos de clientes: en disco o en un bucket privado según STORAGE_DRIVER.
      provide: ChatMediaStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        usesS3(config) ? new S3ChatMediaStorage(s3Bucket(config, 'S3_PRIVATE_BUCKET')) : new LocalChatMediaStorage(),
    },
  ],
  exports: [ConversationService],
})
export class CommunicationModule {}
