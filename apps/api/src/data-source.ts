import { DataSource, DataSourceOptions } from 'typeorm';
import { Company } from './modules/companies-house/entities/company.entity';
import { Officer } from './modules/companies-house/entities/officer.entity';
import { CompanyOfficer } from './modules/companies-house/entities/company-officer.entity';
import { Address } from './modules/companies-house/entities/address.entity';
import { PSC } from './modules/companies-house/entities/psc.entity';
import { Investigation } from './modules/investigation/entities/investigation.entity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'tracegraph',
  password: process.env.POSTGRES_PASSWORD || 'tracegraph',
  database: process.env.POSTGRES_DB || 'tracegraph',
  entities: [Company, Officer, CompanyOfficer, Address, PSC, Investigation],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
  logging: false,
};

export default new DataSource(dataSourceOptions);
