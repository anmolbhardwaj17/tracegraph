import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OffshoreEntity } from './entities/offshore-entity.entity';
import { OffshoreOfficer } from './entities/offshore-officer.entity';
import { OffshoreIntermediary } from './entities/offshore-intermediary.entity';
import { OffshoreRelationship } from './entities/offshore-relationship.entity';
import { OffshoreLeaksService } from './offshore-leaks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OffshoreEntity, OffshoreOfficer, OffshoreIntermediary, OffshoreRelationship]),
  ],
  providers: [OffshoreLeaksService],
  exports: [OffshoreLeaksService],
})
export class OffshoreLeaksModule implements OnModuleInit {
  constructor(private readonly svc: OffshoreLeaksService) {}
  async onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      await this.svc.ingestSampleIfEmpty().catch(() => {});
    }
  }
}
