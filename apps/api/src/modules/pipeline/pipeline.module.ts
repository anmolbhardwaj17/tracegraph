import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';
import { InvestigationNote } from './entities/investigation-note.entity';
import { InvestigationActivity } from './entities/investigation-activity.entity';
import { Investigation } from '../investigation/entities/investigation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Investigation, InvestigationNote, InvestigationActivity])],
  providers: [PipelineService],
  controllers: [PipelineController],
  exports: [PipelineService],
})
export class PipelineModule {}
