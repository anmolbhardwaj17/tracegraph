import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';
import { CompaniesHouseModule } from './modules/companies-house/companies-house.module';
import { InvestigationModule } from './modules/investigation/investigation.module';
import { GraphModule } from './modules/graph/graph.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    CompaniesHouseModule,
    GraphModule,
    InvestigationModule,
  ],
})
export class AppModule {}
