import { Public } from '../auth/guards/jwt-auth.guard';
import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SanctionsEntity } from '../open-sanctions/entities/sanctions-entity.entity';
import { OffshoreEntity } from '../offshore-leaks/entities/offshore-entity.entity';
import { OffshoreOfficer } from '../offshore-leaks/entities/offshore-officer.entity';
import { OffshoreIntermediary } from '../offshore-leaks/entities/offshore-intermediary.entity';

@Public()
@Controller('datasets')
export class DatasetsController {
  constructor(
    @InjectRepository(SanctionsEntity) private readonly sanctions: Repository<SanctionsEntity>,
    @InjectRepository(OffshoreEntity) private readonly offshoreEntities: Repository<OffshoreEntity>,
    @InjectRepository(OffshoreOfficer) private readonly offshoreOfficers: Repository<OffshoreOfficer>,
    @InjectRepository(OffshoreIntermediary) private readonly offshoreIntermediaries: Repository<OffshoreIntermediary>,
  ) {}

  @Get('stats')
  async stats() {
    const [sanctions, offshoreEntities, offshoreOfficers, offshoreIntermediaries] = await Promise.all([
      this.sanctions.count(),
      this.offshoreEntities.count(),
      this.offshoreOfficers.count(),
      this.offshoreIntermediaries.count(),
    ]);
    return { sanctions, offshoreEntities, offshoreOfficers, offshoreIntermediaries };
  }
}
