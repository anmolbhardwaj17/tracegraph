import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FundingEvent } from './entities/funding-event.entity';
import { CapitalEventsService } from './capital-events.service';
import { FundingController } from './funding.controller';
import { Investigation } from '../investigation/entities/investigation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FundingEvent, Investigation])],
  providers: [CapitalEventsService],
  controllers: [FundingController],
  exports: [CapitalEventsService],
})
export class FundingModule {}
