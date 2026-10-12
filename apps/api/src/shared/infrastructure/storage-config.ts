import { ConfigService } from '@nestjs/config';
import { S3Bucket, s3SettingsFromEnv } from './s3-bucket';

/** STORAGE_DRIVER=local (por defecto: disco, sirve para desarrollo y un servidor con disco persistente) o s3. */
export function usesS3(config: ConfigService): boolean {
  return config.get('STORAGE_DRIVER') === 's3';
}

export function requiredEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key)?.trim();
  if (!value) throw new Error(`STORAGE_DRIVER=s3 requiere ${key}`);
  return value;
}

export function s3Bucket(config: ConfigService, bucketKey: string): S3Bucket {
  return new S3Bucket(s3SettingsFromEnv((k) => config.get<string>(k)), requiredEnv(config, bucketKey));
}
