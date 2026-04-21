import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { GeocodingService } from '../geocoding/geocoding.service';
import {
  Enricher, EnrichedCompanyData, EnrichedLocation,
  EnrichedPerson, EnrichedSubsidiary, EnrichedOwner,
} from './enrichment.interface';
import { WikidataEnricher } from './wikidata.enricher';
import { SecFilingsEnricher } from './sec-filings.enricher';
import { OpenCorporatesEnricher } from './opencorporates.enricher';

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly enrichers: Enricher[] = [
    new WikidataEnricher(),
    new SecFilingsEnricher(),
    new OpenCorporatesEnricher(),
  ];

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * Run all applicable enrichers for a company and merge results into the investigation graph.
   * Returns summary stats.
   */
  async enrichCompany(
    investigationId: string,
    rootNodeId: string,
    companyName: string,
    companyId: string,
    jurisdiction: string,
    callbacks?: {
      onEntityDiscovered?: (n: any) => void;
      onEdgeCreated?: (e: any) => void;
      onProgress?: (msg: string) => void;
    },
  ): Promise<{ locationsAdded: number; peopleAdded: number; subsidiariesAdded: number; ownersAdded: number }> {
    const stats = { locationsAdded: 0, peopleAdded: 0, subsidiariesAdded: 0, ownersAdded: 0 };

    // Select enrichers that support this jurisdiction
    const applicable = this.enrichers.filter(
      (e) => e.supportedJurisdictions.length === 0 || e.supportedJurisdictions.includes(jurisdiction),
    );

    this.logger.log(`Running ${applicable.length} enrichers for "${companyName}" (${jurisdiction}): ${applicable.map((e) => e.name).join(', ')}`);
    callbacks?.onProgress?.(`Enriching from ${applicable.length} sources...`);

    // Run all enrichers in parallel
    const results = await Promise.all(
      applicable.map(async (enricher) => {
        try {
          const data = await enricher.enrich(companyName, companyId, jurisdiction);
          return { enricher: enricher.name, data };
        } catch (e: any) {
          this.logger.warn(`Enricher ${enricher.name} failed: ${e?.message}`);
          return { enricher: enricher.name, data: {} as Partial<EnrichedCompanyData> };
        }
      }),
    );

    // Merge all results — deduplicate across sources
    const merged = this.mergeResults(results.map((r) => r.data));

    // Persist locations as address nodes
    for (const loc of merged.locations) {
      try {
        const existingAddr = await this.nodes.findOne({
          where: { investigationId, entityType: 'address', label: loc.label },
        });
        if (existingAddr) continue;

        // Geocode if we don't have coords
        let geo = loc.lat && loc.lng ? { lat: loc.lat, lng: loc.lng, displayName: loc.address } : null;
        if (!geo && loc.address) {
          geo = await this.geocoding.geocode(loc.address).catch(() => null);
        }

        const addrNode = await this.nodes.save(this.nodes.create({
          investigationId,
          entityType: 'address',
          entityId: `addr-${Buffer.from(loc.address).toString('base64').slice(0, 40)}`,
          label: loc.label,
          metadata: {
            raw: { address: loc.address, type: loc.type, country: loc.country },
            geo: geo ? { lat: geo.lat, lng: geo.lng, displayName: geo.displayName } : null,
            enrichmentSource: loc.type,
          },
        }));
        await this.edges.save(this.edges.create({
          investigationId,
          sourceNodeId: rootNodeId,
          targetNodeId: addrNode.id,
          relationshipType: 'address',
          metadata: { type: loc.type },
        })).catch(() => {}); // ignore duplicate edge

        callbacks?.onEntityDiscovered?.({
          id: addrNode.id, entityType: 'address', entityId: addrNode.entityId, label: loc.label,
        });
        stats.locationsAdded++;
      } catch (e: any) {
        this.logger.warn(`Failed to persist location "${loc.label}": ${e?.message}`);
      }
    }

    // Persist people as person nodes (only if not already in graph)
    for (const person of merged.people) {
      try {
        const personId = `enriched-${person.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const existing = await this.nodes.findOne({
          where: { investigationId, entityId: personId },
        });
        if (existing) continue;

        // Also check by label (case-insensitive) to avoid dupes with SEC data
        const byLabel = await this.nodes
          .createQueryBuilder('n')
          .where('n.investigationId = :iid', { iid: investigationId })
          .andWhere('n.entityType = :type', { type: 'person' })
          .andWhere('LOWER(n.label) = :label', { label: person.name.toLowerCase() })
          .getOne();
        if (byLabel) continue;

        const personNode = await this.nodes.save(this.nodes.create({
          investigationId,
          entityType: 'person',
          entityId: personId,
          label: person.name,
          metadata: {
            role: person.role,
            personType: person.type,
            dataSource: person.source,
            isDirector: person.type === 'board',
            isOfficer: person.type === 'executive' || person.type === 'officer',
          },
        }));

        const relType = person.type === 'board' ? 'director' : 'appointment';
        await this.edges.save(this.edges.create({
          investigationId,
          sourceNodeId: rootNodeId,
          targetNodeId: personNode.id,
          relationshipType: relType,
          metadata: { role: person.role, source: person.source },
        })).catch(() => {});

        callbacks?.onEntityDiscovered?.({
          id: personNode.id, entityType: 'person', entityId: personNode.entityId, label: person.name,
        });
        stats.peopleAdded++;
      } catch (e: any) {
        this.logger.warn(`Failed to persist person "${person.name}": ${e?.message}`);
      }
    }

    // Persist subsidiaries as company nodes
    for (const sub of merged.subsidiaries) {
      try {
        const subId = `sub-${sub.name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 60)}`;
        const existing = await this.nodes.findOne({
          where: { investigationId, entityId: subId },
        });
        if (existing) continue;

        // Check by label too
        const byLabel = await this.nodes
          .createQueryBuilder('n')
          .where('n.investigationId = :iid', { iid: investigationId })
          .andWhere('n.entityType = :type', { type: 'company' })
          .andWhere('LOWER(n.label) = :label', { label: sub.name.toLowerCase() })
          .getOne();
        if (byLabel) continue;

        const subNode = await this.nodes.save(this.nodes.create({
          investigationId,
          entityType: 'company',
          entityId: subId,
          label: sub.name,
          metadata: {
            jurisdiction: sub.jurisdiction,
            ownershipPct: sub.ownershipPct,
            status: sub.status,
            dataSource: sub.source,
            isSubsidiary: true,
          },
        }));
        await this.edges.save(this.edges.create({
          investigationId,
          sourceNodeId: rootNodeId,
          targetNodeId: subNode.id,
          relationshipType: 'psc',
          metadata: { type: 'subsidiary', ownershipPct: sub.ownershipPct, source: sub.source },
        })).catch(() => {});

        callbacks?.onEntityDiscovered?.({
          id: subNode.id, entityType: 'company', entityId: subNode.entityId, label: sub.name,
        });
        stats.subsidiariesAdded++;
      } catch (e: any) {
        this.logger.warn(`Failed to persist subsidiary "${sub.name}": ${e?.message}`);
      }
    }

    // Persist parent chain as company nodes with ownership edges
    for (const owner of merged.parentChain) {
      try {
        const ownerId = `owner-${owner.name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 60)}`;
        const existing = await this.nodes.findOne({
          where: { investigationId, entityId: ownerId },
        });
        if (existing) continue;

        const byLabel = await this.nodes
          .createQueryBuilder('n')
          .where('n.investigationId = :iid', { iid: investigationId })
          .andWhere('n.entityType = :type', { type: 'company' })
          .andWhere('LOWER(n.label) = :label', { label: owner.name.toLowerCase() })
          .getOne();
        if (byLabel) continue;

        const ownerNode = await this.nodes.save(this.nodes.create({
          investigationId,
          entityType: 'company',
          entityId: ownerId,
          label: owner.name,
          metadata: {
            jurisdiction: owner.jurisdiction,
            relationship: owner.relationship,
            dataSource: owner.source,
            isParent: true,
          },
        }));
        await this.edges.save(this.edges.create({
          investigationId,
          sourceNodeId: ownerNode.id,
          targetNodeId: rootNodeId,
          relationshipType: 'psc',
          metadata: { type: owner.relationship, source: owner.source },
        })).catch(() => {});

        callbacks?.onEntityDiscovered?.({
          id: ownerNode.id, entityType: 'company', entityId: ownerNode.entityId, label: owner.name,
        });
        stats.ownersAdded++;
      } catch (e: any) {
        this.logger.warn(`Failed to persist owner "${owner.name}": ${e?.message}`);
      }
    }

    // Update root node metadata with enrichment data
    try {
      const rootNode = await this.nodes.findOne({ where: { id: rootNodeId } });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        if (merged.industry) meta.industry = merged.industry;
        if (merged.revenue) meta.revenue = merged.revenue;
        if (merged.website) meta.website = merged.website;
        if (merged.foundedDate) meta.foundedDate = merged.foundedDate;
        if (merged.employeeCount) meta.employeeCount = merged.employeeCount;
        meta.enriched = true;
        meta.enrichmentSources = results.filter((r) => Object.keys(r.data).length > 1).map((r) => r.enricher);
        await this.nodes.update(rootNodeId, { metadata: meta });
      }
    } catch {}

    this.logger.log(
      `Enrichment complete for "${companyName}": ` +
      `+${stats.locationsAdded} locations, +${stats.peopleAdded} people, ` +
      `+${stats.subsidiariesAdded} subsidiaries, +${stats.ownersAdded} owners`,
    );

    return stats;
  }

  /** Merge results from multiple enrichers, deduplicating */
  private mergeResults(results: Partial<EnrichedCompanyData>[]): {
    locations: EnrichedLocation[];
    people: EnrichedPerson[];
    subsidiaries: EnrichedSubsidiary[];
    parentChain: EnrichedOwner[];
    industry: string | null;
    revenue: string | null;
    website: string | null;
    foundedDate: string | null;
    employeeCount: string | null;
  } {
    const locations: EnrichedLocation[] = [];
    const people: EnrichedPerson[] = [];
    const subsidiaries: EnrichedSubsidiary[] = [];
    const parentChain: EnrichedOwner[] = [];
    let industry: string | null = null;
    let revenue: string | null = null;
    let website: string | null = null;
    let foundedDate: string | null = null;
    let employeeCount: string | null = null;

    const seenLocations = new Set<string>();
    const seenPeople = new Set<string>();
    const seenSubs = new Set<string>();
    const seenOwners = new Set<string>();

    for (const r of results) {
      // Locations
      for (const loc of r.locations || []) {
        const key = loc.address.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenLocations.has(key)) {
          seenLocations.add(key);
          locations.push(loc);
        }
      }

      // People — deduplicate by normalized name
      for (const p of r.people || []) {
        const key = p.name.toLowerCase().replace(/[^a-z]/g, '');
        if (!seenPeople.has(key)) {
          seenPeople.add(key);
          people.push(p);
        }
      }

      // Subsidiaries
      for (const s of r.subsidiaries || []) {
        const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenSubs.has(key)) {
          seenSubs.add(key);
          subsidiaries.push(s);
        }
      }

      // Parents
      for (const o of r.parentChain || []) {
        const key = o.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenOwners.has(key)) {
          seenOwners.add(key);
          parentChain.push(o);
        }
      }

      // Scalars: prefer first non-null
      if (!industry && r.industry) industry = r.industry;
      if (!revenue && r.revenue) revenue = r.revenue;
      if (!website && r.website) website = r.website;
      if (!foundedDate && r.foundedDate) foundedDate = r.foundedDate;
      if (!employeeCount && r.employeeCount) employeeCount = r.employeeCount;
    }

    return { locations, people, subsidiaries, parentChain, industry, revenue, website, foundedDate, employeeCount };
  }
}
