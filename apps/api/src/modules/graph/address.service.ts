import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from './entities/graph-node.entity';
import { GraphEdge } from './entities/graph-edge.entity';

/**
 * Post-expansion pass: for each address node in an investigation, count how
 * many companies share it and write that count into node.metadata. This is
 * the in-graph reverse lookup — the BFS already wires all companies that
 * normalize to the same address to a single deduplicated address node.
 */
@Injectable()
export class AddressService {
  private readonly logger = new Logger(AddressService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async clusterAddresses(investigationId: string): Promise<{ clusters: number; multiCompany: number }> {
    const addressNodes = await this.nodes.find({
      where: { investigationId, entityType: 'address' },
    });

    let multiCompany = 0;
    for (const addr of addressNodes) {
      const incoming = await this.edges.find({
        where: { investigationId, targetNodeId: addr.id, relationshipType: 'address' },
      });
      const companyCount = incoming.length;
      addr.metadata = { ...(addr.metadata || {}), companyCount };
      if (companyCount > 1) {
        multiCompany++;
        addr.metadata.suspicious = companyCount >= 5;
      }
      await this.nodes.save(addr);
    }

    this.logger.log(
      `Clustered ${addressNodes.length} addresses (${multiCompany} multi-company) for inv ${investigationId}`,
    );
    return { clusters: addressNodes.length, multiCompany };
  }
}
