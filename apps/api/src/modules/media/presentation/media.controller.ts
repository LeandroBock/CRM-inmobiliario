import { BadRequestException, Controller, HttpCode, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '../../auth/domain/user-role.enum';
import { Roles } from '../../auth/presentation/decorators';
import { PhotoCleanupService } from '../application/photo-cleanup.service';
import { PhotoProcessingService } from '../application/photo-processing.service';

export const MAX_PHOTOS_PER_REQUEST = 20;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

@Controller('media')
export class MediaController {
  constructor(
    private readonly photos: PhotoProcessingService,
    private readonly cleanup: PhotoCleanupService,
  ) {}

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
