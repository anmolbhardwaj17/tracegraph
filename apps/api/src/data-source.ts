import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { DataSource, DataSourceOptions } from 'typeorm';
import { Company } from './modules/companies-house/entities/company.entity';
import { Officer } from './modules/companies-house/entities/officer.entity';
import { CompanyOfficer } from './modules/companies-house/entities/company-officer.entity';
import { Address } from './modules/companies-house/entities/address.entity';
import { PSC } from './modules/companies-house/entities/psc.entity';
import { Investigation } from './modules/investigation/entities/investigation.entity';
import { GraphNode } from './modules/graph/entities/graph-node.entity';
import { GraphEdge } from './modules/graph/entities/graph-edge.entity';
import { SanctionsEntity } from './modules/open-sanctions/entities/sanctions-entity.entity';
import { OffshoreEntity } from './modules/offshore-leaks/entities/offshore-entity.entity';
import { OffshoreOfficer } from './modules/offshore-leaks/entities/offshore-officer.entity';
import { OffshoreIntermediary } from './modules/offshore-leaks/entities/offshore-intermediary.entity';
import { OffshoreRelationship } from './modules/offshore-leaks/entities/offshore-relationship.entity';
import { EntityMatch } from './modules/entity-resolution/entities/entity-match.entity';
import { GeocodeCache } from './modules/geocoding/entities/geocode-cache.entity';
import { LogoCache } from './modules/logos/entities/logo-cache.entity';
import { WatchlistItem } from './modules/watchlist/entities/watchlist-item.entity';
import { ApiKey } from './modules/api-keys/entities/api-key.entity';
import { BatchScreen } from './modules/batch/entities/batch-screen.entity';
import { WatchlistAlert } from './modules/watchlist/entities/watchlist-alert.entity';
import { IndiaCompany } from './modules/india/india-company.entity';
import { User } from './modules/auth/entities/user.entity';
import { AuditLog } from './modules/auth/entities/audit-log.entity';
import { Person } from './modules/persons/entities/person.entity';
import { PersonAppointment } from './modules/persons/entities/person-appointment.entity';
import { InvestigationNote } from './modules/pipeline/entities/investigation-note.entity';
import { InvestigationActivity } from './modules/pipeline/entities/investigation-activity.entity';
import { FundingEvent } from './modules/funding/entities/funding-event.entity';
import { Team } from './modules/teams/entities/team.entity';
import { TeamMember } from './modules/teams/entities/team-member.entity';
import { InvestigationComment } from './modules/teams/entities/investigation-comment.entity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'tracegraph',
  password: process.env.POSTGRES_PASSWORD || 'tracegraph',
  database: process.env.POSTGRES_DB || 'tracegraph',
  entities: [Company, Officer, CompanyOfficer, Address, PSC, Investigation, GraphNode, GraphEdge, SanctionsEntity, OffshoreEntity, OffshoreOfficer, OffshoreIntermediary, OffshoreRelationship, EntityMatch, GeocodeCache, LogoCache, WatchlistItem, WatchlistAlert, ApiKey, BatchScreen, IndiaCompany, User, AuditLog, Person, PersonAppointment, InvestigationNote, InvestigationActivity, FundingEvent, Team, TeamMember, InvestigationComment],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
  logging: false,
};

export default new DataSource(dataSourceOptions);
