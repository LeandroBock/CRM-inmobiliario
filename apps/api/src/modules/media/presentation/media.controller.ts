import { BadRequestException, Body, Controller, Get, HttpCode, Post, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { tmpdir } from 'node:os';
import { diskStorage, memoryStorage } from 'multer';
import { UserRole } from '../../auth/domain/user-role.enum';
import { Roles } from '../../auth/presentation/decorators';
import { PhotoAiAction, PhotoAiService } from '../application/photo-ai.service';
import { PhotoCleanupService } from '../application/photo-cleanup.service';
import { PhotoProcessingService } from '../application/photo-processing.service';
import { MAX_VIDEO_BYTES, VideoUploadService } from '../application/video-upload.service';

class PhotoAiDto {
  @IsUrl({ require_tld: false, require_protocol: true }) url: string;
  @IsIn(['amueblar', 'mejorar', 'ordenar', 'personalizado']) action: PhotoAiAction;
  @IsOptional() @IsString() @MaxLength(300) instructions?: string;
}

export const MAX_PHOTOS_PER_REQUEST = 20;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

@Controller('media')
export class MediaController {
  constructor(
    private readonly photos: PhotoProcessingService,
    private readonly cleanup: PhotoCleanupService,
    private readonly videos: VideoUploadService,
    private readonly photoAi: PhotoAiService,
  ) {}

  /** Si la edición de fotos con IA está configurada (Cloudflare). */
  @Get('photos/ai')
  photoAiStatus() {
    return this.photoAi.status();
  }

  /** Edita una foto del CRM con IA (amueblar, mejorar, ordenar...). Devuelve una foto NUEVA; la original queda igual. */
  @Post('photos/ai')
  @HttpCode(201)
  editWithAi(@Body() dto: PhotoAiDto) {
    return this.photoAi.edit(dto);
  }

  /**
   * Un video (MP4 o MOV, hasta 50 MB) en el campo "file", para publicar en redes. Se recibe en un archivo temporal
   * (no en memoria: el servidor gratis tiene 512 MB) y se pasa al almacenamiento. Devuelve su URL pública.
   */
  @Post('videos')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (/^video\//.test(file.mimetype) || /\.(mp4|mov)$/i.test(file.originalname)) cb(null, true);
        else cb(new BadRequestException(`"${file.originalname}" no es un video`), false);
      },
    }),
  )
  uploadVideo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No llegó ningún video');
    return this.videos.save(file);
  }

  /**
   * multipart/form-data con uno o más archivos en el campo "files".
   * Devuelve las URLs de los JPG ya procesados, en el mismo orden en que se enviaron.
   */
  @Post('photos')
  @HttpCode(201)
  @UseInterceptors(
    FilesInterceptor('files', MAX_PHOTOS_PER_REQUEST, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        // Filtro rápido por tipo declarado; la validación real es que sharp pueda decodificarla.
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new BadRequestException(`"${file.originalname}" no es una imagen`), false);
      },
    }),
  )
  uploadPhotos(@UploadedFiles() files: Express.Multer.File[]) {
    return this.photos.processAll(files);
  }

  /** Borra ya las fotos huérfanas con más de 24 h (también corre sola todas las noches). */
  @Post('photos/cleanup')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  runCleanup() {
    return this.cleanup.cleanup();
  }
}
