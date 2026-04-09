import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export interface TemporalAnomalies {
  massIncorporation: Array<{ windowStart: string; windowEnd: string; companyIds: string[] }>;
  massDissolution: Array<{ windowStart: string; windowEnd: string; companyIds: string[] }>;
  rapidDissolution: Array<{ companyId: string; label: string; lifespanMonths: number }>;
  preEventResignations: Array<{ personId: string; label: string; resignations: number; windowDays: number }>;
}

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class TemporalAnomalyService {
  private readonly logger = new Logger(TemporalAnomalyService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async detect(investigationId: string): Promise<TemporalAnomalies> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    const companies = nodes.filter((n) => n.entityType === 'company');

    const incorporations: Array<{ id: string; date: number }> = [];
    const dissolutions: Array<{ id: string; date: number }> = [];
    const rapidDissolution: TemporalAnomalies['rapidDissolution'] = [];

    for (const c of companies) {
      const inc = c.metadata?.incorporationDate;
      const diss = c.metadata?.dissolutionDate;
      if (inc) incorporations.push({ id: c.id, date: new Date(inc).getTime() });
      if (diss) dissolutions.push({ id: c.id, date: new Date(diss).getTime() });
      if (inc && diss) {
        const months = (new Date(diss).getTime() - new Date(inc).getTime()) / (DAY * 30);
        if (months > 0 && months < 18) {
          rapidDissolution.push({ companyId: c.id, label: c.label, lifespanMonths: Math.round(months) });
        }
      }
    }

    const massIncorporation = this.findClusters(incorporations, 30, 3);
    const massDissolution = this.findClusters(dissolutions, 30, 3);

    // Pre-event director resignations: by person, look at resignedOn dates from director edges
    const personResignations = new Map<string, number[]>();
    const personLabel = new Map<string, string>();
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const resignedOn = e.metadata?.resignedOn;
      if (!resignedOn) continue;
      const src = nodes.find((n) => n.id === e.sourceNodeId);
      const tgt = nodes.find((n) => n.id === e.targetNodeId);
      const person = src?.entityType === 'person' ? src : tgt?.entityType === 'person' ? tgt : null;
      if (!person) continue;
      const t = new Date(resignedOn).getTime();
      if (Number.isNaN(t)) continue;
      const list = personResignations.get(person.id) || [];
      list.push(t);
      personResignations.set(person.id, list);
      personLabel.set(person.id, person.label);
    }

    const preEventResignations: TemporalAnomalies['preEventResignations'] = [];
    for (const [personId, dates] of personResignations.entries()) {
      dates.sort((a, b) => a - b);
      // Sliding window 90 days, look for >=3 resignations
      for (let i = 0; i < dates.length; i++) {
        let j = i;
        while (j < dates.length && dates[j] - dates[i] <= 90 * DAY) j++;
        if (j - i >= 3) {
          preEventResignations.push({
            personId,
            label: personLabel.get(personId) || personId,
            resignations: j - i,
            windowDays: 90,
          });
          break;
        }
      }
    }

    const result = { massIncorporation, massDissolution, rapidDissolution, preEventResignations };
    this.logger.log(
      `Temporal anomalies: ${massIncorporation.length} mass-inc, ${massDissolution.length} mass-diss, ${rapidDissolution.length} rapid-diss, ${preEventResignations.length} resignation clusters`,
    );
    return result;
  }

  private findClusters(
    events: Array<{ id: string; date: number }>,
    windowDays: number,
    minSize: number,
  ): Array<{ windowStart: string; windowEnd: string; companyIds: string[] }> {
    const sorted = [...events].sort((a, b) => a.date - b.date);
    const clusters: Array<{ windowStart: string; windowEnd: string; companyIds: string[] }> = [];
    const used = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].id)) continue;
      const group: typeof sorted = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].date - sorted[i].date <= windowDays * DAY) {
          group.push(sorted[j]);
        } else break;
      }
      if (group.length >= minSize) {
        for (const g of group) used.add(g.id);
        clusters.push({
          windowStart: new Date(group[0].date).toISOString().slice(0, 10),
          windowEnd: new Date(group[group.length - 1].date).toISOString().slice(0, 10),
          companyIds: group.map((g) => g.id),
        });
      }
    }
    return clusters;
  }
}
