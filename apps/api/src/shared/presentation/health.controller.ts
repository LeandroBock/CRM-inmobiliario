import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Public } from '../../modules/auth/presentation/decorators';

/** Para el healthcheck de Docker y monitores externos (UptimeRobot, etc.). No expone datos. */
@Controller('health')
export class HealthController {
  constructor(private readonly db: DataSource) {}

  @Get()
  @Public()
  @SkipThrottle()
  async check() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Sin conexión a la base de datos');
    }
    return { status: 'ok' };
  }
}
