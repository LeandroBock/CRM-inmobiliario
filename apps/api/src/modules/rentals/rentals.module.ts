import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/domain/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Property } from '../properties/domain/property.entity';
import { IndexService } from './application/index.service';
import { RentalsService } from './application/rentals.service';
import { IndexValue } from './domain/index-value.entity';
import { RentalAdjustment } from './domain/rental-adjustment.entity';
import { RentalContract } from './domain/rental-contract.entity';
import { RentalPayment } from './domain/rental-payment.entity';
import { IndexSources } from './infrastructure/index-sources';
import { RentalsController } from './presentation/rentals.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RentalContract, RentalAdjustment, RentalPayment, IndexValue, Property, User]), NotificationsModule],
  controllers: [RentalsController],
  providers: [RentalsService, IndexService, IndexSources],
})
export class RentalsModule {}
