import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';
import { CompaniesHouseModule } from './modules/companies-house/companies-house.module';
import { InvestigationModule } from './modules/investigation/investigation.module';
import { GraphModule } from './modules/graph/graph.module';
import { OpenSanctionsModule } from './modules/open-sanctions/open-sanctions.module';
import { OffshoreLeaksModule } from './modules/offshore-leaks/offshore-leaks.module';
import { EntityResolutionModule } from './modules/entity-resolution/entity-resolution.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    CompaniesHouseModule,
    GraphModule,
    OpenSanctionsModule,
    OffshoreLeaksModule,
    EntityResolutionModule,
    InvestigationModule,
  ],
})
export class AppModule {}
