import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requiredEnv, s3Bucket, usesS3 } from '../../shared/infrastructure/storage-config';
import { PhotoCleanupService } from './application/photo-cleanup.service';
import { PhotoProcessingService } from './application/photo-processing.service';
import { PHOTO_STORAGE } from './domain/photo-storage.port';
import { LocalPhotoStorage } from './infrastructure/local-photo.storage';
import { S3PhotoStorage } from './infrastructure/s3-photo.storage';
import { VideoUploadService } from './application/video-upload.service';
import { VIDEO_STORAGE } from './domain/video-storage.port';
import { LocalVideoStorage, S3VideoStorage } from './infrastructure/video.storage';
import { MediaController } from './presentation/media.controller';

@Module({
  controllers: [MediaController],
  providers: [PhotoProcessingService, PhotoCleanupService, VideoUploadService, {
      provide: VIDEO_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        usesS3(config)
          ? new S3VideoStorage(s3Bucket(config, 'S3_PUBLIC_BUCKET'), requiredEnv(config, 'S3_PUBLIC_URL').replace(/\/+$/, ''))
          : new LocalVideoStorage(config),
    }, {
      provide: PHOTO_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        usesS3(config)
          ? new S3PhotoStorage(s3Bucket(config, 'S3_PUBLIC_BUCKET'), requiredEnv(config, 'S3_PUBLIC_URL').replace(/\/+$/, ''))
          : new LocalPhotoStorage(config),
    }],
  exports: [VIDEO_STORAGE],
})
export class MediaModule {}
