import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investigation } from './entities/investigation.entity';
import { GraphExpansionService } from '../graph/graph-expansion.service';
import { AddressService } from '../graph/address.service';
import { CompaniesHouseService } from '../companies-house/companies-house.service';
import { InvestigationGateway } from './investigation.gateway';

export const INVESTIGATION_QUEUE = 'investigation';

export interface InvestigationJobData {
  investigationId: string;
  query: string;
}

@Processor(INVESTIGATION_QUEUE)
export class InvestigationProcessor extends WorkerHost {
  private readonly logger = new Logger(InvestigationProcessor.name);

  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    private readonly expansion: GraphExpansionService,
    private readonly addressService: AddressService,
    private readonly ch: CompaniesHouseService,
    private readonly gateway: InvestigationGateway,
  ) {
    super();
  }

  async process(job: Job<InvestigationJobData>): Promise<void> {
    const { investigationId, query } = job.data;
    this.logger.log(`Processing investigation ${investigationId} (${query})`);

    try {
      await this.investigations.update(investigationId, { status: 'FETCHING' });

      const companyNumber = await this.resolveCompanyNumber(query);
      if (!companyNumber) throw new Error('Company not found');

      await this.investigations.update(investigationId, {
        status: 'EXPANDING',
        metadata: { companyNumber } as any,
      });

      const result = await this.expansion.expand(
        investigationId,
        companyNumber,
        {},
        {
          onEntityDiscovered: (n) =>
            this.gateway.emitEntityDiscovered(investigationId, {
              id: n.id,
              entityType: n.entityType,
              entityId: n.entityId,
              label: n.label,
            }),
          onEdgeCreated: (e) =>
            this.gateway.emitEdgeCreated(investigationId, {
              id: e.id,
              source: e.sourceNodeId,
              target: e.targetNodeId,
              type: e.relationshipType,
            }),
          onProgress: (p) => {
            this.gateway.emitProgress(investigationId, p);
            // Periodically persist
            this.investigations.update(investigationId, { progress: p as any }).catch(() => {});
          },
        },
      );

      const addressClusters = await this.addressService.clusterAddresses(investigationId);

      await this.investigations.update(investigationId, {
        status: 'COMPLETE',
        completedAt: new Date(),
        progress: { ...result, addressClusters } as any,
      });
      this.gateway.emitComplete(investigationId, result);
    } catch (err: any) {
      this.logger.error(`Investigation ${investigationId} failed: ${err?.message}`);
      await this.investigations.update(investigationId, {
        status: 'FAILED',
        completedAt: new Date(),
        metadata: { error: err?.message } as any,
      });
      this.gateway.emitComplete(investigationId, { status: 'failed', error: err?.message });
    }
  }

  private async resolveCompanyNumber(query: string): Promise<string | null> {
    if (/^[A-Z0-9]{6,10}$/i.test(query.trim())) return query.trim().toUpperCase();
    const result = await this.ch.searchCompanies(query).catch(() => null);
    return result?.items?.[0]?.company_number || null;
  }
}
