import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/application/jwt-auth.guard';
import { RolesGuard } from './modules/auth/application/roles.guard';
import { AvoModule } from './modules/avo/avo.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { LeadEngineModule } from './modules/lead-engine/lead-engine.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MediaModule } from './modules/media/media.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { SocialMediaModule } from './modules/social-media/social-media.module';
import { GoogleCalendarModule } from './modules/google-calendar/google-calendar.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { VisitsModule } from './modules/visits/visits.module';
import { databaseConnection } from './shared/infrastructure/database-config';
import { HealthController } from './shared/presentation/health.controller';

@Module({
  imports: [
    // En los tests (NODE_ENV=test, lo pone Jest) no se lee el .env: así nunca usan claves reales (WhatsApp, SMTP...).
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.NODE_ENV === 'test' }),
    ScheduleModule.forRoot(),
    // Límite general por IP; el login tiene uno más estricto (ver AuthController).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // DB_SYNC=true solo en desarrollo: TypeORM ajusta las tablas a las entidades (puede borrar columnas).
        // Sin DB_SYNC, al arrancar se aplican las migraciones pendientes de src/migrations (ver README).
        const sync = config.get('DB_SYNC') === 'true';
        return {
          type: 'postgres' as const,
          ...databaseConnection((key) => config.get<string>(key)),
          autoLoadEntities: true,
          synchronize: sync,
          migrations: [join(__dirname, 'migrations', '*.js')],
          migrationsTableName: 'migrations',
          migrationsRun: !sync,
        };
      },
    }),
    AuthModule,
    PropertiesModule,
    MediaModule,
    LeadsModule,
    AvoModule,
    CommunicationModule,
    LeadEngineModule,
    SocialMediaModule,
    DashboardModule,
    VisitsModule,
    NotificationsModule,
    GoogleCalendarModule,
  ],
  controllers: [HealthController],
  providers: [
    // El orden importa: primero límite de velocidad, luego autenticación, luego roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
