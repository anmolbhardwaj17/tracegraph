import { Module, forwardRef } from '@nestjs/common';
import { ReportService } from './report.service';
import { InvestigationModule } from '../investigation/investigation.module';

@Module({
  imports: [forwardRef(() => InvestigationModule)],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
