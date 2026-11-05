import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  /**
   * Sube una imagen desde memoria. Con un publicId fijo, cada subida
   * reemplaza a la anterior (no quedan archivos huérfanos).
   */
  uploadImage(
    file: Express.Multer.File,
    folder: string,
    publicId: string,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          overwrite: true,
          invalidate: true,
          resource_type: 'image',
          transformation: [{ width: 512, height: 512, crop: 'limit' }],
        },
        (error, result) => {
          if (error || !result) {
            return reject(
              new InternalServerErrorException(
                `No se pudo subir la imagen: ${error?.message ?? 'sin respuesta'}`,
              ),
            );
          }
          resolve(result);
        },
      );
      stream.end(file.buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `No se pudo eliminar la imagen: ${(err as Error).message}`,
      );
    }
  }
}
