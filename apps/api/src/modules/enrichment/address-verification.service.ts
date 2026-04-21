import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

/** Known virtual office / mailbox service providers and address keywords */
const VIRTUAL_OFFICE_KEYWORDS = [
  'regus', 'wework', 'spaces', 'hq ', 'iwg ', 'servcorp', 'davinci',
  'opus virtual', 'alliance virtual', 'virtual office', 'business center',
  'executive suite', 'mail boxes etc', 'the ups store', 'ups store',
  'mailboxes etc', 'po box', 'p.o. box', 'postbox', 'post box',
  'suite ', 'ste ', 'unit ', 'floor ', 'level ',
  'c/o ', 'care of', 'attn:',
  'registered agent', 'corporation service', 'ct corporation',
  'national registered agents', 'nrai', 'legalinc',
  'incorp services', 'cogency global', 'paracorp',
];

/** Known formation agent / registered agent addresses (US) */
const FORMATION_AGENT_ADDRESSES = [
  // Delaware — most popular registered agent addresses
  '1209 orange st', '1013 centre rd', '251 little falls',
  '2711 centerville', '850 new burton', '1679 s dupont',
  '16192 coastal hwy', '3500 south dupont', '108 west 13th',
  '1521 concord pike',
  // Nevada
  '701 s carson st', '311 s division st',
  // Wyoming
  '1712 pioneer ave', '30 n gould st',
];

/**
 * Address Verification & Business Location Intelligence.
 *
 * For each address in the investigation graph:
 * 1. Check against known virtual office / mailbox providers
 * 2. Check against known formation agent addresses
 * 3. Use Overpass API (OpenStreetMap) to verify what's at the location
 * 4. Flag residential addresses used as business registrations
 */
@Injectable()
export class AddressVerificationService {
  private readonly logger = new Logger(AddressVerificationService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async verify(investigationId: string): Promise<{ results: AddressResult[]; findings: Finding[] }> {
    const addresses = await this.nodes.find({
      where: { investigationId, entityType: 'address' },
    });

    // Also check company registered addresses from metadata
    const companies = await this.nodes.find({
      where: { investigationId, entityType: 'company' },
    });

    this.logger.log(`Address verification: checking ${addresses.length} address nodes + ${companies.length} company addresses`);

    const results: AddressResult[] = [];

    // Check address nodes
    for (const addr of addresses) {
      const raw = (addr.metadata as any)?.raw?.address || addr.label;
      if (!raw || raw.length < 5) continue;
      const result = await this.checkAddress(raw, addr.id, addr.entityId);
      results.push(result);

      // Update node metadata
      if (result.flags.length > 0) {
        const meta = (addr.metadata || {}) as any;
        meta.addressVerification = {
          flags: result.flags,
          classification: result.classification,
          osmType: result.osmType,
          verifiedAt: new Date().toISOString(),
        };
        await this.nodes.update(addr.id, { metadata: meta }).catch(() => {});
      }
    }

    // Check company registered addresses
    for (const co of companies) {
      const regAddr = (co.metadata as any)?.registeredAddress;
      if (!regAddr || regAddr.length < 5) continue;
      const result = await this.checkAddress(regAddr, co.id, co.entityId);
      if (result.flags.length > 0) results.push(result);
    }

    const findings = this.generateFindings(results);

    this.logger.log(`Address verification complete: ${results.length} checked, ${results.filter((r) => r.flags.length > 0).length} flagged`);
    return { results, findings };
  }

  private async checkAddress(address: string, nodeId: string, entityId: string): Promise<AddressResult> {
    const normalized = address.toLowerCase().trim();
    const result: AddressResult = {
      address,
      nodeId,
      entityId,
      flags: [],
      classification: 'UNKNOWN',
      osmType: null,
    };

    // 1. Check against virtual office keywords
    for (const kw of VIRTUAL_OFFICE_KEYWORDS) {
      if (normalized.includes(kw)) {
        result.flags.push('VIRTUAL_OFFICE');
        result.classification = 'VIRTUAL_OFFICE';
        break;
      }
    }

    // 2. Check against known formation agent addresses
    for (const fa of FORMATION_AGENT_ADDRESSES) {
      if (normalized.includes(fa)) {
        result.flags.push('FORMATION_AGENT_ADDRESS');
        result.classification = 'FORMATION_AGENT';
        break;
      }
    }

    // 3. Check PO Box
    if (/\bp\.?o\.?\s*box\b/i.test(normalized) || /\bpostbox\b/i.test(normalized)) {
      result.flags.push('PO_BOX');
      if (result.classification === 'UNKNOWN') result.classification = 'PO_BOX';
    }

    // 4. Use Overpass API to check what's at this location (if we have geocoded coordinates)
    try {
      // Try to get coordinates from Nominatim
      const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: address, format: 'json', limit: 1, addressdetails: 1 },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 8000,
      });

      const hit = geoRes.data?.[0];
      if (hit) {
        const osmClass = hit.class || '';
        const osmType = hit.type || '';
        const addressDetails = hit.address || {};

        result.osmType = `${osmClass}/${osmType}`;

        // Check if residential
        if (
          osmType === 'house' || osmType === 'residential' || osmType === 'apartments' ||
          osmClass === 'place' && (osmType === 'house' || osmType === 'hamlet') ||
          osmClass === 'building' && osmType === 'residential'
        ) {
          result.flags.push('RESIDENTIAL_ADDRESS');
          if (result.classification === 'UNKNOWN') result.classification = 'RESIDENTIAL';
        }

        // Check if it's a known business area
        if (osmClass === 'office' || osmClass === 'commercial' || osmType === 'commercial') {
          result.classification = 'COMMERCIAL';
        }

        // Check if it's a rural/remote location (unusual for a company)
        if (osmType === 'hamlet' || osmType === 'isolated_dwelling' || osmType === 'farm') {
          result.flags.push('RURAL_ADDRESS');
        }
      }
    } catch {
      // Non-critical — geocoding may fail
    }

    if (result.classification === 'UNKNOWN' && result.flags.length === 0) {
      result.classification = 'UNVERIFIED';
    }

    return result;
  }

  private generateFindings(results: AddressResult[]): Finding[] {
    const findings: Finding[] = [];

    const virtualOffices = results.filter((r) => r.flags.includes('VIRTUAL_OFFICE'));
    const formationAgents = results.filter((r) => r.flags.includes('FORMATION_AGENT_ADDRESS'));
    const poBoxes = results.filter((r) => r.flags.includes('PO_BOX'));
    const residential = results.filter((r) => r.flags.includes('RESIDENTIAL_ADDRESS'));

    if (virtualOffices.length > 0) {
      findings.push({
        type: 'VIRTUAL_OFFICE_ADDRESS',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${virtualOffices.length} address${virtualOffices.length !== 1 ? 'es' : ''} linked to virtual office providers`,
        description: `${virtualOffices.length} registered address${virtualOffices.length !== 1 ? 'es are' : ' is'} associated with known virtual office or coworking providers (Regus, WeWork, etc). Virtual offices provide legitimate business addresses but are also commonly used by shell companies to obscure their true operating location.`,
        evidence: virtualOffices.map((r) => `${r.address} — virtual office detected`),
        affectedEntities: virtualOffices.map((r) => r.entityId),
        recommendation: 'Verify the company has actual employees and operations at this address. Request proof of physical presence.',
      });
    }

    if (formationAgents.length > 0) {
      findings.push({
        type: 'FORMATION_AGENT_ADDRESS',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `${formationAgents.length} address${formationAgents.length !== 1 ? 'es' : ''} at known formation agent locations`,
        description: `${formationAgents.length} address${formationAgents.length !== 1 ? 'es match' : ' matches'} known corporate formation agent locations (CT Corporation, National Registered Agents, etc). These addresses host hundreds or thousands of registered companies and provide no information about actual business operations.`,
        evidence: formationAgents.map((r) => `${r.address} — formation agent address`),
        affectedEntities: formationAgents.map((r) => r.entityId),
        recommendation: 'This is a standard practice for Delaware/Nevada LLCs but provides no assurance of legitimate operations. Request the actual operating address.',
      });
    }

    if (residential.length > 0) {
      findings.push({
        type: 'RESIDENTIAL_BUSINESS_ADDRESS',
        severity: 'LOW',
        confidence: 'MEDIUM',
        title: `${residential.length} business address${residential.length !== 1 ? 'es appear' : ' appears'} residential`,
        description: `OpenStreetMap data indicates ${residential.length} registered business address${residential.length !== 1 ? 'es are' : ' is'} in residential areas. This is common for small businesses but unusual for larger entities.`,
        evidence: residential.map((r) => `${r.address} — classified as ${r.osmType || 'residential'}`),
        affectedEntities: residential.map((r) => r.entityId),
        recommendation: 'Verify whether the business size is consistent with a residential address. Large companies operating from residential addresses warrant additional scrutiny.',
      });
    }

    return findings;
  }
}

export interface AddressResult {
  address: string;
  nodeId: string;
  entityId: string;
  flags: string[];
  classification: 'VIRTUAL_OFFICE' | 'FORMATION_AGENT' | 'PO_BOX' | 'RESIDENTIAL' | 'COMMERCIAL' | 'UNVERIFIED' | 'UNKNOWN';
  osmType: string | null;
}
