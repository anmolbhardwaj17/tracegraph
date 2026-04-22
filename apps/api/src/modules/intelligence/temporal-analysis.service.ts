import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { Finding } from '../risk-scoring/finding.types';

export interface TemporalResult {
  clusters: Array<{ period: string; events: Array<{ entity: string; type: string; date: string }>; significance: string }>;
  sequences: Array<{ pattern: string; entities: string[]; severity: string }>;
  velocity: { eventsPerMonth: number; trend: 'ACCELERATING' | 'STABLE' | 'DECELERATING' };
  findings: Finding[];
}

/**
 * Phase IV: Temporal Pattern Analysis.
 *
 * Analyzes the timing of events across the network to detect
 * coordinated activities:
 * - Mass incorporations on the same date
 * - Synchronized resignations
 * - Phoenix company patterns (dissolve → reincorporate)
 * - Velocity changes (sudden spike in activity)
 */
@Injectable()
export class TemporalAnalysisService {
  private readonly logger = new Logger(TemporalAnalysisService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async analyze(investigationId: string): Promise<TemporalResult> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    this.logger.log(`Temporal analysis: ${nodes.length} nodes`);

    // Extract all dated events from node metadata
    const events: Array<{ nodeId: string; label: string; type: string; date: Date; dateStr: string }> = [];

    for (const n of nodes) {
      const meta = (n.metadata || {}) as any;

      // Incorporation / registration dates
      const incDate = meta.incorporationDate || meta.foundedDate || meta.dateOfRegistration;
      if (incDate) {
        const d = new Date(incDate);
        if (!isNaN(d.getTime())) events.push({ nodeId: n.id, label: n.label, type: 'incorporation', date: d, dateStr: incDate });
      }

      // Dissolution dates
      if (meta.dissolutionDate) {
        const d = new Date(meta.dissolutionDate);
        if (!isNaN(d.getTime())) events.push({ nodeId: n.id, label: n.label, type: 'dissolution', date: d, dateStr: meta.dissolutionDate });
      }

      // Appointment dates (from role metadata)
      if (meta.appointedOn) {
        const d = new Date(meta.appointedOn);
        if (!isNaN(d.getTime())) events.push({ nodeId: n.id, label: n.label, type: 'appointment', date: d, dateStr: meta.appointedOn });
      }

      // Resignation dates
      if (meta.resignedOn) {
        const d = new Date(meta.resignedOn);
        if (!isNaN(d.getTime())) events.push({ nodeId: n.id, label: n.label, type: 'resignation', date: d, dateStr: meta.resignedOn });
      }
    }

    events.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 1. Temporal clustering — find events bunched in time
    const clusters = this.findClusters(events);

    // 2. Sequence patterns — detect suspicious event sequences
    const sequences = this.findSequences(events, nodes);

    // 3. Velocity — how fast is the network changing?
    const velocity = this.computeVelocity(events);

    // Generate findings
    const findings = this.generateFindings(clusters, sequences, velocity);

    this.logger.log(
      `Temporal analysis complete: ${clusters.length} clusters, ${sequences.length} sequences, velocity=${velocity.eventsPerMonth.toFixed(1)}/mo (${velocity.trend})`,
    );

    return { clusters, sequences, velocity, findings };
  }

  /** Find events that cluster within 7-day windows */
  private findClusters(events: typeof this.analyze extends (...a: any) => Promise<{ clusters: infer C }> ? C extends Array<infer E> ? { nodeId: string; label: string; type: string; date: Date; dateStr: string }[] : never : never): TemporalResult['clusters'] {
    // Type workaround — just use the events array
    return this.findClustersImpl(events as any);
  }

  private findClustersImpl(events: Array<{ nodeId: string; label: string; type: string; date: Date; dateStr: string }>): TemporalResult['clusters'] {
    const clusters: TemporalResult['clusters'] = [];
    const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (let i = 0; i < events.length; i++) {
      const windowEvents = [events[i]];
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].date.getTime() - events[i].date.getTime() <= WINDOW_MS) {
          windowEvents.push(events[j]);
        } else break;
      }

      if (windowEvents.length >= 3) {
        const uniqueEntities = new Set(windowEvents.map((e) => e.nodeId));
        if (uniqueEntities.size >= 3) {
          // Multiple entities with events in the same week
          const types = [...new Set(windowEvents.map((e) => e.type))];
          let significance = 'Multiple events in same week';
          if (types.includes('incorporation') && windowEvents.filter((e) => e.type === 'incorporation').length >= 3) {
            significance = 'Mass incorporation — 3+ companies registered in same week';
          }
          if (types.includes('resignation') && windowEvents.filter((e) => e.type === 'resignation').length >= 3) {
            significance = 'Synchronized resignations — 3+ directors left in same week';
          }

          clusters.push({
            period: `${events[i].dateStr} to ${windowEvents[windowEvents.length - 1].dateStr}`,
            events: windowEvents.map((e) => ({ entity: e.label, type: e.type, date: e.dateStr })),
            significance,
          });

          i += windowEvents.length - 1; // Skip past this cluster
        }
      }
    }

    return clusters.slice(0, 10);
  }

  /** Detect suspicious event sequences per entity */
  private findSequences(
    events: Array<{ nodeId: string; label: string; type: string; date: Date; dateStr: string }>,
    nodes: GraphNode[],
  ): TemporalResult['sequences'] {
    const sequences: TemporalResult['sequences'] = [];

    // Group events by entity
    const byEntity = new Map<string, typeof events>();
    for (const e of events) {
      if (!byEntity.has(e.nodeId)) byEntity.set(e.nodeId, []);
      byEntity.get(e.nodeId)!.push(e);
    }

    for (const [nodeId, entityEvents] of byEntity) {
      const types = entityEvents.map((e) => e.type);

      // Phoenix pattern: dissolution → new incorporation nearby
      if (types.includes('dissolution')) {
        const dissDate = entityEvents.find((e) => e.type === 'dissolution')!.date;
        // Check if any incorporation happened within 6 months after
        const nearby = events.filter(
          (e) => e.type === 'incorporation' && e.nodeId !== nodeId &&
          e.date.getTime() > dissDate.getTime() &&
          e.date.getTime() - dissDate.getTime() < 180 * 24 * 60 * 60 * 1000,
        );
        if (nearby.length > 0) {
          sequences.push({
            pattern: 'PHOENIX_COMPANY',
            entities: [entityEvents[0].label, ...nearby.map((n) => n.label)],
            severity: 'HIGH',
          });
        }
      }

      // Rapid appointment → resignation (< 1 year)
      const appointments = entityEvents.filter((e) => e.type === 'appointment');
      const resignations = entityEvents.filter((e) => e.type === 'resignation');
      for (const app of appointments) {
        const quickResign = resignations.find(
          (r) => r.date.getTime() > app.date.getTime() &&
          r.date.getTime() - app.date.getTime() < 365 * 24 * 60 * 60 * 1000,
        );
        if (quickResign) {
          sequences.push({
            pattern: 'RAPID_TURNOVER',
            entities: [entityEvents[0].label],
            severity: 'MEDIUM',
          });
          break;
        }
      }
    }

    return sequences.slice(0, 10);
  }

  /** Compute network event velocity */
  private computeVelocity(events: Array<{ date: Date }>): TemporalResult['velocity'] {
    if (events.length < 2) return { eventsPerMonth: 0, trend: 'STABLE' };

    const firstDate = events[0].date.getTime();
    const lastDate = events[events.length - 1].date.getTime();
    const months = Math.max(1, (lastDate - firstDate) / (30 * 24 * 60 * 60 * 1000));
    const eventsPerMonth = events.length / months;

    // Trend: compare first half vs second half
    const midpoint = firstDate + (lastDate - firstDate) / 2;
    const firstHalf = events.filter((e) => e.date.getTime() < midpoint).length;
    const secondHalf = events.filter((e) => e.date.getTime() >= midpoint).length;

    let trend: TemporalResult['velocity']['trend'] = 'STABLE';
    if (secondHalf > firstHalf * 1.5) trend = 'ACCELERATING';
    else if (firstHalf > secondHalf * 1.5) trend = 'DECELERATING';

    return { eventsPerMonth, trend };
  }

  private generateFindings(
    clusters: TemporalResult['clusters'],
    sequences: TemporalResult['sequences'],
    velocity: TemporalResult['velocity'],
  ): Finding[] {
    const findings: Finding[] = [];

    // Mass events
    const massInc = clusters.filter((c) => c.significance.includes('Mass incorporation'));
    if (massInc.length > 0) {
      findings.push({
        type: 'MASS_INCORPORATION',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `${massInc.length} mass incorporation event(s) detected`,
        description: `Multiple companies in the network were incorporated within the same week. This is a common pattern in shell company mills and formation-agent-driven incorporations.`,
        evidence: massInc.map((c) => `${c.period}: ${c.events.length} events — ${c.significance}`),
        affectedEntities: [],
        recommendation: 'Investigate whether these companies share the same formation agent, address, or directors.',
      });
    }

    // Synchronized resignations
    const syncResign = clusters.filter((c) => c.significance.includes('Synchronized'));
    if (syncResign.length > 0) {
      findings.push({
        type: 'SYNCHRONIZED_RESIGNATIONS',
        severity: 'HIGH',
        confidence: 'MEDIUM',
        title: `Synchronized director resignations detected`,
        description: `Multiple directors resigned from network companies within the same week. Coordinated departures may indicate awareness of adverse events or coordinated fraud.`,
        evidence: syncResign.map((c) => `${c.period}: ${c.events.map((e) => e.entity).join(', ')}`),
        affectedEntities: [],
        recommendation: 'Investigate what triggered the coordinated departures. Check for regulatory actions or financial distress around those dates.',
      });
    }

    // Phoenix patterns
    const phoenix = sequences.filter((s) => s.pattern === 'PHOENIX_COMPANY');
    if (phoenix.length > 0) {
      findings.push({
        type: 'PHOENIX_PATTERN',
        severity: 'HIGH',
        confidence: 'MEDIUM',
        title: `${phoenix.length} potential phoenix company pattern(s)`,
        description: `A company was dissolved and a new company was incorporated shortly after by connected parties. Phoenix companies are used to evade debts and liabilities.`,
        evidence: phoenix.map((s) => `Entities: ${s.entities.join(' → ')}`),
        affectedEntities: [],
        recommendation: 'Check whether the dissolved and new companies share directors, addresses, or business activities.',
      });
    }

    return findings;
  }
}
