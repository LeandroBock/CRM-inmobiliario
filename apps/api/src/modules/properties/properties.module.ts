import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { FxService } from './application/fx.service';
import { PropertiesService } from './application/properties.service';
import { Property } from './domain/property.entity';
import { PropertiesController } from './presentation/properties.controller';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Property]), GoogleCalendarModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, FxService],
  exports: [PropertiesService, FxService],
})
export class PropertiesModule {}
