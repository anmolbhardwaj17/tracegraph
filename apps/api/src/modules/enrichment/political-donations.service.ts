import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const FEC_API = 'https://api.open.fec.gov/v1';
const API_KEY = 'DEMO_KEY'; // Free, rate-limited but functional
const USER_AGENT = 'TraceGraph/0.1';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface DonationRecord {
  personName: string;
  personNodeId: string;
  committeeName: string;
  candidateName: string | null;
  amount: number;
  date: string;
  employer: string | null;
  party: string | null;
}

/**
 * FEC Political Donation Lookup.
 *
 * Searches the Federal Election Commission database for political
 * contributions by key people in the investigation graph. Extends
 * PEP detection with financial political connections.
 *
 * Uses the free FEC API (DEMO_KEY — 1000 requests/hour).
 */
@Injectable()
export class PoliticalDonationsService {
  private readonly logger = new Logger(PoliticalDonationsService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async search(investigationId: string): Promise<{ donations: DonationRecord[]; findings: Finding[] }> {
    const people = await this.nodes.find({
      where: { investigationId, entityType: 'person' },
    });

    // Only search key people (board, executives, PEPs) — max 10
    const keyPeople = people
      .filter((p) => {
        const meta = p.metadata as any;
        return meta?.isPep || meta?.personType === 'executive' || meta?.personType === 'board' ||
               meta?.isDirector || meta?.role?.toLowerCase()?.includes('ceo');
      })
      .slice(0, 10);

    if (keyPeople.length === 0) {
      // Fall back to all people, max 5
      keyPeople.push(...people.slice(0, 5));
    }

    this.logger.log(`FEC donation search: checking ${keyPeople.length} key people`);

    const allDonations: DonationRecord[] = [];

    for (const person of keyPeople) {
      try {
        const donations = await this.searchPerson(person);
        allDonations.push(...donations);
      } catch { /* continue */ }
    }

    const findings = this.generateFindings(allDonations);

    // Update person nodes with donation info
    for (const person of keyPeople) {
      const personDonations = allDonations.filter((d) => d.personNodeId === person.id);
      if (personDonations.length > 0) {
        try {
          const meta = (person.metadata || {}) as any;
          meta.politicalDonations = {
            totalAmount: personDonations.reduce((s, d) => s + d.amount, 0),
            donationCount: personDonations.length,
            parties: [...new Set(personDonations.map((d) => d.party).filter(Boolean))],
            topRecipients: personDonations
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 3)
              .map((d) => ({ name: d.committeeName, amount: d.amount })),
          };
          await this.nodes.update(person.id, { metadata: meta });
        } catch {}
      }
    }

    this.logger.log(`FEC search complete: ${allDonations.length} donations found across ${new Set(allDonations.map((d) => d.personName)).size} people`);
    return { donations: allDonations, findings };
  }

  private async searchPerson(node: GraphNode): Promise<DonationRecord[]> {
    const name = node.label;
    if (!name || name.length < 4) return [];

    // Clean name for FEC search
    const cleanName = name
      .replace(/^(Mr|Mrs|Ms|Dr|Prof|Sir)\.\s*/i, '')
      .replace(/\s+(Jr|Sr|III|IV|II)\s*\.?$/i, '')
      .trim();

    return cached(`fec:${cleanName.toLowerCase()}`, async () => {
      try {
        const res = await axios.get(`${FEC_API}/schedules/schedule_a/`, {
          params: {
            contributor_name: cleanName,
            api_key: API_KEY,
            sort: '-contribution_receipt_date',
            per_page: 20,
            min_date: new Date(Date.now() - 4 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // last 4 years
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 30000,
        });

        const results = res.data?.results || [];
        return results
          .filter((r: any) => {
            // Verify name match — FEC does substring matching so we need to verify
            const fecName = (r.contributor_name || '').toLowerCase();
            const targetParts = cleanName.toLowerCase().split(/\s+/);
            return targetParts.every((p: string) => p.length < 3 || fecName.includes(p));
          })
          .map((r: any) => ({
            personName: name,
            personNodeId: node.id,
            committeeName: r.committee?.name || r.committee_name || 'Unknown',
            candidateName: r.candidate_name || null,
            amount: r.contribution_receipt_amount || 0,
            date: r.contribution_receipt_date || '',
            employer: r.contributor_employer || null,
            party: r.committee?.party || null,
          }));
      } catch (e: any) {
        this.logger.warn(`FEC search failed for "${cleanName}": ${e?.message}`);
        return [];
      }
    });
  }

  private generateFindings(donations: DonationRecord[]): Finding[] {
    if (donations.length === 0) return [];

    const findings: Finding[] = [];

    // Group by person
    const byPerson = new Map<string, DonationRecord[]>();
    for (const d of donations) {
      if (!byPerson.has(d.personName)) byPerson.set(d.personName, []);
      byPerson.get(d.personName)!.push(d);
    }

    // Large individual donors
    for (const [name, personDonations] of byPerson) {
      const total = personDonations.reduce((s, d) => s + d.amount, 0);
      if (total > 10000) {
        const parties = [...new Set(personDonations.map((d) => d.party).filter(Boolean))];
        findings.push({
          type: 'POLITICAL_DONOR',
          severity: total > 100000 ? 'MEDIUM' : 'LOW',
          confidence: 'HIGH',
          title: `${name} donated $${total.toLocaleString()} to political campaigns`,
          description: `${name} made ${personDonations.length} political contribution${personDonations.length !== 1 ? 's' : ''} totaling $${total.toLocaleString()} in the last 4 years. ` +
            `${parties.length > 0 ? `Party affiliations: ${parties.join(', ')}. ` : ''}` +
            `Political donations by key officers may indicate political connections that are relevant for government contract and regulatory risk assessment.`,
          evidence: personDonations
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5)
            .map((d) => `${d.date}: $${d.amount.toLocaleString()} to ${d.committeeName}`),
          affectedEntities: [personDonations[0]?.personNodeId].filter(Boolean),
          recommendation: 'Document political connections for anti-corruption compliance. Cross-reference with any government contracts the company holds.',
        });
      }
    }

    // Summary if multiple donors found
    if (byPerson.size > 1) {
      const totalAll = donations.reduce((s, d) => s + d.amount, 0);
      findings.push({
        type: 'POLITICAL_NETWORK',
        severity: 'LOW',
        confidence: 'HIGH',
        title: `${byPerson.size} officers with political donations ($${totalAll.toLocaleString()} total)`,
        description: `${byPerson.size} people in this network have FEC-recorded political contributions totaling $${totalAll.toLocaleString()}. This indicates a politically connected entity.`,
        evidence: [...byPerson.entries()].map(([name, ds]) => `${name}: ${ds.length} donations, $${ds.reduce((s, d) => s + d.amount, 0).toLocaleString()}`),
        affectedEntities: [],
        recommendation: 'Consider political connections when assessing regulatory risk and government contract exposure.',
      });
    }

    return findings;
  }
}
