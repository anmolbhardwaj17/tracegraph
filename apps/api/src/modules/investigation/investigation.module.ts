import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investigation } from './entities/investigation.entity';
import { InvestigationService } from './investigation.service';
import { InvestigationController } from './investigation.controller';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';
import { Company } from '../companies-house/entities/company.entity';
import { Officer } from '../companies-house/entities/officer.entity';
import { CompanyOfficer } from '../companies-house/entities/company-officer.entity';
import { Address } from '../companies-house/entities/address.entity';
import { PSC } from '../companies-house/entities/psc.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investigation, Company, Officer, CompanyOfficer, Address, PSC]),
    CompaniesHouseModule,
  ],
  providers: [InvestigationService],
  controllers: [InvestigationController],
})
export class InvestigationModule {}
