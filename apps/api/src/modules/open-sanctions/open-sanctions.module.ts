import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SanctionsEntity } from './entities/sanctions-entity.entity';
import { OpenSanctionsService } from './open-sanctions.service';

@Module({
  imports: [TypeOrmModule.forFeature([SanctionsEntity])],
  providers: [OpenSanctionsService],
  exports: [OpenSanctionsService],
})
export class OpenSanctionsModule implements OnModuleInit {
  constructor(private readonly svc: OpenSanctionsService) {}
  async onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      await this.svc.ingestSampleIfEmpty().catch(() => {});
    }
  }
}
