import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Person } from './entities/person.entity';
import { PersonAppointment } from './entities/person-appointment.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    @InjectRepository(Person) private readonly persons: Repository<Person>,
    @InjectRepository(PersonAppointment) private readonly appointments: Repository<PersonAppointment>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  /** Run after an investigation completes — extract and deduplicate all persons */
  async upsertFromInvestigation(investigationId: string): Promise<void> {
    try {
      const personNodes = await this.nodes.find({ where: { investigationId, entityType: 'person' } });
      if (personNodes.length === 0) return;

      // Load all edges to find company → person links
      const allEdges = await this.edges.find({ where: { investigationId } });
      const edgesByTarget = new Map<string, string[]>(); // targetNodeId → [sourceNodeId]
      for (const e of allEdges) {
        const existing = edgesByTarget.get(e.targetNodeId) || [];
        existing.push(e.sourceNodeId);
        edgesByTarget.set(e.targetNodeId, existing);
      }

      // Load all company nodes
      const companyNodes = await this.nodes.find({ where: { investigationId, entityType: 'company' } });
      const companyById = new Map(companyNodes.map((c) => [c.id, c]));

      for (const node of personNodes) {
        const m = node.metadata as any || {};
        const canonicalName = node.label?.trim() || 'Unknown';
        const normalizedName = this.normalizeName(canonicalName);
        if (!normalizedName) continue;

        const dobMonth: number | null = m.dateOfBirthMonth || m.dobMonth || null;
        const dobYear: number | null = m.dateOfBirthYear || m.dobYear || null;
        const nationality: string | null = m.nationality || null;

        // Find or create canonical person record
        const person = await this.findOrCreatePerson(canonicalName, normalizedName, dobMonth, dobYear, nationality, m);

        // Update person node metadata with person ID for direct linking
        if (person) {
          await this.nodes.update(node.id, { metadata: { ...m, personId: person.id } });
        }

        // Create appointment records for each company this person is linked to
        const sourceNodeIds = edgesByTarget.get(node.id) || [];
        for (const sourceId of sourceNodeIds) {
          const companyNode = companyById.get(sourceId);
          if (!companyNode) continue;
          const cm = companyNode.metadata as any || {};

          try {
            await this.appointments
              .createQueryBuilder()
              .insert()
              .values({
                personId: person.id,
                investigationId,
                companyEntityId: companyNode.entityId,
                companyName: companyNode.label,
                companyStatus: cm.status || cm.companyStatus || null,
                companyJurisdiction: cm.jurisdiction || 'gb',
                role: m.role || null,
                appointedOn: m.appointedOn ? new Date(m.appointedOn) : null,
                resignedOn: m.resignedOn ? new Date(m.resignedOn) : null,
                source: 'companies-house',
              })
              .orIgnore() // skip duplicate (person_id, investigation_id, company_entity_id)
              .execute();
          } catch {
            // ignore individual appointment failures
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`upsertFromInvestigation failed for ${investigationId}: ${e?.message}`);
    }
  }

  /** Fuzzy name search across persons table */
  async search(q: string, limit = 20): Promise<Person[]> {
    const normalized = this.normalizeName(q);
    if (!normalized) return [];

    return this.persons
      .createQueryBuilder('p')
      .where(`p.normalized_name ILIKE :q`, { q: `%${normalized}%` })
      .orderBy(`similarity(p.normalized_name, :exact)`, 'DESC')
      .setParameter('exact', normalized)
      .limit(limit)
      .getMany()
      .catch(() =>
        // fallback without similarity if pg_trgm not available
        this.persons
          .createQueryBuilder('p')
          .where(`p.normalized_name ILIKE :q`, { q: `%${normalized}%` })
          .limit(limit)
          .getMany(),
      );
  }

  /** Full person profile including all appointments */
  async findById(id: string): Promise<(Person & { trackRecord: any[] }) | null> {
    const person = await this.persons.findOne({ where: { id } });
    if (!person) return null;
    const trackRecord = await this.getTrackRecord(id);
    return { ...person, trackRecord };
  }

  /** Chronological track record across all investigations */
  async getTrackRecord(personId: string): Promise<any[]> {
    const appts = await this.appointments
      .createQueryBuilder('a')
      .where('a.person_id = :personId', { personId })
      .orderBy('a.appointed_on', 'DESC', 'NULLS LAST')
      .getMany();

    // Deduplicate by company_entity_id (same company across multiple investigations)
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const a of appts) {
      if (seen.has(a.companyEntityId)) continue;
      seen.add(a.companyEntityId);
      unique.push({
        companyEntityId: a.companyEntityId,
        companyName: a.companyName,
        companyStatus: a.companyStatus,
        companyJurisdiction: a.companyJurisdiction,
        role: a.role,
        appointedOn: a.appointedOn,
        resignedOn: a.resignedOn,
        isActive: !a.resignedOn && a.companyStatus !== 'dissolved',
        isDissolved: a.companyStatus === 'dissolved',
        investigationId: a.investigationId,
      });
    }
    return unique;
  }

  /** Stats for a person — totals, dissolved count, active count */
  async getStats(personId: string) {
    const track = await this.getTrackRecord(personId);
    return {
      total: track.length,
      active: track.filter((a) => a.isActive).length,
      dissolved: track.filter((a) => a.isDissolved).length,
      resigned: track.filter((a) => a.resignedOn && !a.isDissolved).length,
    };
  }

  private async findOrCreatePerson(
    canonicalName: string,
    normalizedName: string,
    dobMonth: number | null,
    dobYear: number | null,
    nationality: string | null,
    metadata: any,
  ): Promise<Person> {
    // Look for existing person by normalized name
    const candidates = await this.persons.find({ where: { normalizedName } });

    for (const candidate of candidates) {
      // If both have DOB year: must match
      if (dobYear && candidate.dobYear) {
        if (candidate.dobYear !== dobYear) continue;
        if (dobMonth && candidate.dobMonth && candidate.dobMonth !== dobMonth) continue;
      }
      // Name match (already normalized name matched) + DOB compatible — same person
      await this.persons.update(candidate.id, {
        lastSeenAt: new Date(),
        investigationCount: candidate.investigationCount + 1,
        signals: this.mergeSignals(candidate.signals || {}, metadata),
        // Update nationality if now known
        ...(nationality && !candidate.nationality ? { nationality } : {}),
        ...(dobMonth && !candidate.dobMonth ? { dobMonth } : {}),
        ...(dobYear && !candidate.dobYear ? { dobYear } : {}),
      });
      return { ...candidate, investigationCount: candidate.investigationCount + 1 };
    }

    // Create new person
    return this.persons.save(
      this.persons.create({
        canonicalName,
        normalizedName,
        dobMonth,
        dobYear,
        nationality,
        investigationCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        signals: this.extractSignals(metadata),
        metadata: {
          firstRole: metadata.role,
          firstSeen: new Date().toISOString(),
        },
      }),
    );
  }

  private normalizeName(name: string): string {
    return (name || '')
      .toLowerCase()
      .replace(/\b(mr|mrs|ms|miss|dr|sir|dame|lord|lady|prof|professor|rev|reverend|rt\s+hon|the\s+hon|hon)\b\.?\s*/gi, '')
      .replace(/[^a-z\s'-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractSignals(m: any): Record<string, any> {
    return {
      isPep: !!m.isPep,
      isSanctioned: !!m.sanctionsHit,
      isDisqualified: !!m.isDisqualified,
      dissolvedCount: m.directorRisk?.dissolvedCount || 0,
      appointmentCount: m.appointmentCount || 1,
    };
  }

  private mergeSignals(existing: Record<string, any>, newMeta: any): Record<string, any> {
    const newSig = this.extractSignals(newMeta);
    return {
      isPep: existing.isPep || newSig.isPep,
      isSanctioned: existing.isSanctioned || newSig.isSanctioned,
      isDisqualified: existing.isDisqualified || newSig.isDisqualified,
      dissolvedCount: Math.max(existing.dissolvedCount || 0, newSig.dissolvedCount || 0),
      appointmentCount: Math.max(existing.appointmentCount || 1, newSig.appointmentCount || 1),
    };
  }
}
