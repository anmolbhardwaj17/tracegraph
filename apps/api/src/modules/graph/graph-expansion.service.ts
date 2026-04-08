import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode, GraphEntityType } from './entities/graph-node.entity';
import { GraphEdge, RelationshipType } from './entities/graph-edge.entity';
import { CompaniesHouseService } from '../companies-house/companies-house.service';
import { normalizeAddress } from './address-normalizer';

export interface ExpansionOptions {
  maxCompanyDepth?: number; // default 2
  maxAddressDepth?: number; // default 1
  largeCompanyOfficerThreshold?: number; // default 100
}

export interface ExpansionProgress {
  entitiesDiscovered: number;
  edgesCreated: number;
  apiCallsMade: number;
  currentDepth: number;
  status: 'running' | 'complete' | 'failed';
}

export interface ExpansionEvents {
  onEntityDiscovered?: (node: GraphNode) => void;
  onEdgeCreated?: (edge: GraphEdge) => void;
  onProgress?: (p: ExpansionProgress) => void;
}

interface QueueItem {
  kind: 'company' | 'officer';
  id: string; // companyNumber or officer externalId
  depth: number;
  parentNodeId?: string;
  edgeType?: RelationshipType;
  edgeMetadata?: Record<string, any>;
}

@Injectable()
export class GraphExpansionService {
  private readonly logger = new Logger(GraphExpansionService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    private readonly ch: CompaniesHouseService,
  ) {}

  async expand(
    investigationId: string,
    rootCompanyNumber: string,
    options: ExpansionOptions = {},
    events: ExpansionEvents = {},
  ): Promise<ExpansionProgress> {
    const maxCompanyDepth = options.maxCompanyDepth ?? 2;
    const maxAddressDepth = options.maxAddressDepth ?? 1;
    const largeThreshold = options.largeCompanyOfficerThreshold ?? 100;

    const visitedCompanies = new Set<string>();
    const visitedOfficers = new Set<string>();
    const addressNodeCache = new Map<string, string>(); // normalized -> nodeId

    const progress: ExpansionProgress = {
      entitiesDiscovered: 0,
      edgesCreated: 0,
      apiCallsMade: 0,
      currentDepth: 0,
      status: 'running',
    };

    // Priority queue: lower depth first (BFS by level)
    const queue: QueueItem[] = [
      { kind: 'company', id: rootCompanyNumber, depth: 0 },
    ];

    const upsertNode = async (
      entityType: GraphEntityType,
      entityId: string,
      label: string,
      metadata: Record<string, any> = {},
    ): Promise<GraphNode> => {
      let node = await this.nodes.findOne({
        where: { investigationId, entityType, entityId },
      });
      if (!node) {
        node = this.nodes.create({ investigationId, entityType, entityId, label, metadata });
        node = await this.nodes.save(node);
        progress.entitiesDiscovered++;
        events.onEntityDiscovered?.(node);
        events.onProgress?.({ ...progress });
      }
      return node;
    };

    const upsertEdge = async (
      sourceNodeId: string,
      targetNodeId: string,
      relationshipType: RelationshipType,
      metadata: Record<string, any> = {},
    ): Promise<void> => {
      if (sourceNodeId === targetNodeId) return;
      const existing = await this.edges.findOne({
        where: { investigationId, sourceNodeId, targetNodeId, relationshipType },
      });
      if (existing) return;
      const edge = await this.edges.save(
        this.edges.create({ investigationId, sourceNodeId, targetNodeId, relationshipType, metadata }),
      );
      progress.edgesCreated++;
      events.onEdgeCreated?.(edge);
      events.onProgress?.({ ...progress });
    };

    while (queue.length > 0) {
      // pop the lowest-depth item (priority by depth)
      queue.sort((a, b) => a.depth - b.depth);
      const item = queue.shift()!;
      progress.currentDepth = Math.max(progress.currentDepth, item.depth);

      if (item.kind === 'company') {
        if (visitedCompanies.has(item.id)) {
          // still create edge if needed
          if (item.parentNodeId && item.edgeType) {
            const existing = await this.nodes.findOne({
              where: { investigationId, entityType: 'company', entityId: item.id },
            });
            if (existing) await upsertEdge(item.parentNodeId, existing.id, item.edgeType, item.edgeMetadata || {});
          }
          continue;
        }
        visitedCompanies.add(item.id);

        let profile: any;
        try {
          profile = await this.ch.getCompany(item.id);
          progress.apiCallsMade++;
        } catch (e: any) {
          this.logger.warn(`getCompany ${item.id} failed: ${e?.message}`);
          continue;
        }

        const companyNode = await upsertNode('company', profile.company_number, profile.company_name, {
          status: profile.company_status,
          incorporationDate: profile.date_of_creation,
          companyType: profile.type,
        });

        if (item.parentNodeId && item.edgeType) {
          await upsertEdge(item.parentNodeId, companyNode.id, item.edgeType, item.edgeMetadata || {});
        }

        // Address node (depth-bounded)
        if (item.depth <= maxAddressDepth && profile.registered_office_address) {
          const normalized = normalizeAddress({
            addressLine1: profile.registered_office_address.address_line_1,
            addressLine2: profile.registered_office_address.address_line_2,
            locality: profile.registered_office_address.locality,
            postalCode: profile.registered_office_address.postal_code,
            country: profile.registered_office_address.country,
          });
          if (normalized) {
            let addrNodeId = addressNodeCache.get(normalized);
            if (!addrNodeId) {
              const addrNode = await upsertNode('address', normalized, normalized, {
                raw: profile.registered_office_address,
              });
              addrNodeId = addrNode.id;
              addressNodeCache.set(normalized, addrNodeId);
            }
            await upsertEdge(companyNode.id, addrNodeId, 'address', {});
          }
        }

        // Officers
        let officersResp: any;
        try {
          officersResp = await this.ch.getOfficers(item.id);
          progress.apiCallsMade++;
        } catch (e: any) {
          this.logger.warn(`getOfficers ${item.id} failed: ${e?.message}`);
          officersResp = { items: [] };
        }

        const totalOfficers = officersResp.total_results ?? officersResp.items?.length ?? 0;
        const skipExpansion = totalOfficers > largeThreshold;
        if (skipExpansion) {
          this.logger.log(`Skipping officer expansion for ${item.id} (${totalOfficers} officers)`);
        }

        for (const o of officersResp.items || []) {
          const externalId =
            o.links?.officer?.appointments?.split('/')[2] ||
            o.links?.self?.split('/').pop() ||
            o.name;
          const personNode = await upsertNode('person', externalId, o.name, {
            nationality: o.nationality,
            dateOfBirth: o.date_of_birth,
          });
          await upsertEdge(companyNode.id, personNode.id, 'director', {
            role: o.officer_role,
            appointedOn: o.appointed_on,
            resignedOn: o.resigned_on,
          });

          if (!skipExpansion && item.depth + 1 <= maxCompanyDepth && !visitedOfficers.has(externalId)) {
            queue.push({
              kind: 'officer',
              id: externalId,
              depth: item.depth + 1,
              parentNodeId: personNode.id,
            });
          }
        }

        // PSCs
        let pscResp: any;
        try {
          pscResp = await this.ch.getPSC(item.id);
          progress.apiCallsMade++;
        } catch {
          pscResp = { items: [] };
        }
        for (const p of pscResp.items || []) {
          const pscId = p.links?.self || `${p.name}-${item.id}`;
          const pscNode = await upsertNode('person', pscId, p.name, {
            kind: p.kind,
            naturesOfControl: p.natures_of_control,
          });
          await upsertEdge(companyNode.id, pscNode.id, 'psc', {
            naturesOfControl: p.natures_of_control,
          });
        }
      } else if (item.kind === 'officer') {
        if (visitedOfficers.has(item.id)) continue;
        visitedOfficers.add(item.id);

        let appts: any;
        try {
          appts = await this.ch.getOfficerAppointments(item.id);
          progress.apiCallsMade++;
        } catch (e: any) {
          this.logger.warn(`getOfficerAppointments ${item.id} failed: ${e?.message}`);
          continue;
        }

        for (const a of appts.items || []) {
          const otherCompany = a.appointed_to?.company_number;
          if (!otherCompany) continue;
          if (visitedCompanies.has(otherCompany)) {
            // still draw edge from this person to existing company node
            const existing = await this.nodes.findOne({
              where: { investigationId, entityType: 'company', entityId: otherCompany },
            });
            if (existing && item.parentNodeId) {
              await upsertEdge(existing.id, item.parentNodeId, 'director', {
                role: a.officer_role,
                appointedOn: a.appointed_on,
              });
            }
            continue;
          }
          if (item.depth <= maxCompanyDepth) {
            queue.push({
              kind: 'company',
              id: otherCompany,
              depth: item.depth,
              parentNodeId: item.parentNodeId,
              edgeType: 'appointment',
              edgeMetadata: { role: a.officer_role, appointedOn: a.appointed_on },
            });
          }
        }
      }
    }

    progress.status = 'complete';
    events.onProgress?.({ ...progress });
    return progress;
  }
}
