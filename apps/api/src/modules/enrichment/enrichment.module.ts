import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnrichmentService } from './enrichment.service';
import { AiNarrativeService } from './ai-narrative.service';
import { PepDetectionService } from './pep-detection.service';
import { AdverseMediaService } from './adverse-media.service';
import { SecIntelligenceService } from './sec-intelligence.service';
import { WebIntelligenceService } from './web-intelligence.service';
import { SanctionsDirectService } from './sanctions-direct.service';
import { AddressVerificationService } from './address-verification.service';
import { WaybackService } from './wayback.service';
import { PoliticalDonationsService } from './political-donations.service';
import { RegulatoryViolationsService } from './regulatory-violations.service';
import { CfpbComplaintsService } from './cfpb-complaints.service';
import { FatfJurisdictionService } from './fatf-jurisdiction.service';
import { PatentSearchService } from './patent-search.service';
import { NonprofitLookupService } from './nonprofit-lookup.service';
import { LinkedInIntelligenceService } from './linkedin-intelligence.service';
import { IndiaIntelligenceService } from './india-intelligence.service';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { GeocodingModule } from '../geocoding/geocoding.module';

const services = [
  EnrichmentService, AiNarrativeService, PepDetectionService,
  AdverseMediaService, SecIntelligenceService, WebIntelligenceService,
  SanctionsDirectService, AddressVerificationService, WaybackService,
  PoliticalDonationsService, RegulatoryViolationsService,
  CfpbComplaintsService, FatfJurisdictionService,
  PatentSearchService, NonprofitLookupService,
  LinkedInIntelligenceService,
  IndiaIntelligenceService,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphNode, GraphEdge]),
    GeocodingModule,
  ],
  providers: services,
  exports: services,
})
export class EnrichmentModule {}
