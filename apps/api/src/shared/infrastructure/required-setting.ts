import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Las integraciones (redes, WhatsApp, Claude) son opcionales: su clave se exige recién cuando se usan.
 * Así la API arranca aunque falte configurar alguna, y esa función falla con un mensaje claro.
 */
export function requiredSetting(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  // 503 con el motivo: la pantalla le muestra al usuario qué falta en vez de un error genérico.
  if (!value) throw new ServiceUnavailableException(`Falta configurar ${key} en el .env de la API`);
  return value;
}
