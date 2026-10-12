import { Controller, Get, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
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

  /** TEMPORAL (diagnóstico de TRUST_PROXY en Render): devuelve solo los datos de red del propio pedido. */
  @Get('ip')
  @Public()
  @SkipThrottle()
  ip(@Req() req: Request) {
    const h = (k: string) => req.headers[k] ?? null;
    return {
      ip: req.ip,
      ips: req.ips,
      socket: req.socket.remoteAddress,
      xForwardedFor: h('x-forwarded-for'),
      cfConnectingIp: h('cf-connecting-ip'),
      trueClientIp: h('true-client-ip'),
      xRealIp: h('x-real-ip'),
      xEnvoyExternalAddress: h('x-envoy-external-address'),
    };
  }
}
