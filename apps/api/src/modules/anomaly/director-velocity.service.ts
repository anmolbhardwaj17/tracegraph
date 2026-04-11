import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

const YEAR = 365 * 24 * 60 * 60 * 1000;
const MONTH = 30 * 24 * 60 * 60 * 1000;

export interface VelocityMetrics {
  totalAppointments: number;
  activeAppointments: number;
  resignations: number;
  yearsActive: number;
  appointmentsPerYear: number;
  resignationRate: number;
  avgTenureMonths: number;
  flagged: boolean;
  reasons: string[];
}

@Injectable()
export class DirectorVelocityService {
  private readonly logger = new Logger(DirectorVelocityService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async scoreAll(investigationId: string): Promise<{ scored: number; flagged: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const persons = nodes.filter((n) => n.entityType === 'person');
    const companies = nodes.filter((n) => n.entityType === 'company');
    const companyMap = new Map(companies.map((c) => [c.id, c]));
    const now = Date.now();

    let scored = 0;
    let flagged = 0;

    // Build director edges per person
    const directorEdges = edges.filter(
      (e) => e.relationshipType === 'director' || e.relationshipType === 'appointment',
    );

    const edgesByPerson = new Map<string, GraphEdge[]>();
    for (const e of directorEdges) {
      const personId = persons.find((p) => p.id === e.sourceNodeId) ? e.sourceNodeId
        : persons.find((p) => p.id === e.targetNodeId) ? e.targetNodeId : null;
      if (!personId) continue;
      const list = edgesByPerson.get(personId) || [];
      list.push(e);
      edgesByPerson.set(personId, list);
    }

    for (const person of persons) {
      const personEdges = edgesByPerson.get(person.id) || [];
      if (personEdges.length < 2) continue; // Need at least 2 appointments to compute velocity

      let totalAppointments = personEdges.length;
      let resignations = 0;
      let activeAppointments = 0;
      const tenures: number[] = [];
      let earliestAppointment = Infinity;
      let latestActivity = 0;

      for (const e of personEdges) {
        const appointedOn = e.metadata?.appointedOn ? new Date(e.metadata.appointedOn).getTime() : null;
        const resignedOn = e.metadata?.resignedOn ? new Date(e.metadata.resignedOn).getTime() : null;

        if (appointedOn && appointedOn < earliestAppointment) earliestAppointment = appointedOn;
        if (appointedOn && appointedOn > latestActivity) latestActivity = appointedOn;
        if (resignedOn && resignedOn > latestActivity) latestActivity = resignedOn;

        if (resignedOn) {
          resignations++;
          if (appointedOn) {
            const tenure = (resignedOn - appointedOn) / MONTH;
            if (tenure > 0) tenures.push(tenure);
          }
        } else {
          activeAppointments++;
          if (appointedOn) {
            const tenure = (now - appointedOn) / MONTH;
            if (tenure > 0) tenures.push(tenure);
          }
        }
      }

      const yearsActive = earliestAppointment < Infinity
        ? Math.max(0.5, (latestActivity - earliestAppointment) / YEAR)
        : 1;

      const appointmentsPerYear = Math.round((totalAppointments / yearsActive) * 10) / 10;
      const resignationRate = Math.round((resignations / totalAppointments) * 100);
      const avgTenureMonths = tenures.length > 0
        ? Math.round((tenures.reduce((s, t) => s + t, 0) / tenures.length) * 10) / 10
        : 0;

      const reasons: string[] = [];
      let isFlagged = false;

      if (appointmentsPerYear > 5) {
        reasons.push(`${appointmentsPerYear} appointments/year (threshold: 5)`);
        isFlagged = true;
      }
      if (resignationRate > 70) {
        reasons.push(`${resignationRate}% resignation rate (threshold: 70%)`);
        isFlagged = true;
      }
      if (avgTenureMonths > 0 && avgTenureMonths < 12) {
        reasons.push(`Average tenure ${avgTenureMonths} months (threshold: 12)`);
        isFlagged = true;
      }

      const velocity: VelocityMetrics = {
        totalAppointments,
        activeAppointments,
        resignations,
        yearsActive: Math.round(yearsActive * 10) / 10,
        appointmentsPerYear,
        resignationRate,
        avgTenureMonths,
        flagged: isFlagged,
        reasons,
      };

      person.metadata = { ...(person.metadata || {}), directorVelocity: velocity };
      await this.nodes.update(person.id, { metadata: person.metadata as any });
      scored++;
      if (isFlagged) flagged++;
    }

    this.logger.log(`DirectorVelocity ${investigationId}: scored=${scored} flagged=${flagged}`);
    return { scored, flagged };
  }
}
