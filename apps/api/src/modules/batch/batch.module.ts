import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchScreen } from './entities/batch-screen.entity';
import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';
import { InvestigationModule } from '../investigation/investigation.module';
import { Investigation } from '../investigation/entities/investigation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BatchScreen, Investigation]),
    InvestigationModule,
  ],
  providers: [BatchService],
  controllers: [BatchController],
  exports: [BatchService],
})
export class BatchModule {}
