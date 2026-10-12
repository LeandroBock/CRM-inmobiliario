import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from '../properties/domain/property.entity';
import { ComparablesService } from './application/comparables.service';
import { AvoService } from './application/avo.service';
import { AvoPrediction } from './domain/avo-prediction.entity';
import { AvoController } from './presentation/avo.controller';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([AvoPrediction, Property])],
  controllers: [AvoController],
  providers: [AvoService, ComparablesService],
  exports: [AvoService],
})
export class AvoModule {}
