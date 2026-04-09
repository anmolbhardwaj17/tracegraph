/* eslint-disable */
import 'reflect-metadata';
import dataSource from '../data-source';
import { Investigation } from '../modules/investigation/entities/investigation.entity';
import { GraphNode } from '../modules/graph/entities/graph-node.entity';
import { GraphEdge } from '../modules/graph/entities/graph-edge.entity';
import { EntityMatch } from '../modules/entity-resolution/entities/entity-match.entity';

/**
 * Demo seed: builds a fully pre-computed investigation that exercises every
 * Phase 1-5 feature so the frontend can render a complete report without
 * needing API keys, BullMQ, or any live services.
 */

async function run() {
  await dataSource.initialize();
  const inv = dataSource.getRepository(Investigation);
  const nodes = dataSource.getRepository(GraphNode);
  const edges = dataSource.getRepository(GraphEdge);
  const matches = dataSource.getRepository(EntityMatch);

  // Wipe any existing demo
  const existing = await inv.findOne({ where: { query: 'DEMO: Petrov Holdings UK Ltd' } });
  if (existing) {
    await edges.delete({ investigationId: existing.id });
    await nodes.delete({ investigationId: existing.id });
    await matches.delete({ investigationId: existing.id });
    await inv.delete(existing.id);
  }

  const investigation = await inv.save(
    inv.create({
      query: 'DEMO: Petrov Holdings UK Ltd',
      status: 'COMPLETE',
      completedAt: new Date(),
    }),
  );
  const invId = investigation.id;

  // Helpers
  const personIds: string[] = [];
  const companyIds: string[] = [];
  const addressIds: string[] = [];

  const mkNode = async (
    type: 'company' | 'person' | 'address',
    entityId: string,
    label: string,
    metadata: any = {},
    proximityScore?: string,
    proximityHops?: number,
  ) => {
    const n = await nodes.save(
      nodes.create({
        investigationId: invId,
        entityType: type,
        entityId,
        label,
        metadata,
        proximityScore: proximityScore || 'CLEAR',
        proximityHops: proximityHops ?? null as any,
      }),
    );
    if (type === 'person') personIds.push(n.id);
    if (type === 'company') companyIds.push(n.id);
    if (type === 'address') addressIds.push(n.id);
    return n;
  };

  const mkEdge = async (src: string, tgt: string, rel: string, meta: any = {}) => {
    return edges.save(
      edges.create({
        investigationId: invId,
        sourceNodeId: src,
        targetNodeId: tgt,
        relationshipType: rel as any,
        metadata: meta,
      }),
    );
  };

  // Root company
  const root = await mkNode('company', '12345678', 'Petrov Holdings UK Ltd', {
    status: 'active',
    incorporationDate: '2010-03-15',
    companyType: 'ltd',
    sicCodes: ['64209'],
    shellCompanyScore: { score: 65, risk: 'HIGH', reasons: [
      'Director "Vladimir Petrov" has 18 active companies',
      'Director "Vladimir Petrov" has 6 dissolved companies',
      'Registered at virtual office address shared by 27 companies',
      'Files dormant accounts',
    ]},
  }, 'CRITICAL', 0);

  // Sanctioned director
  const vladimir = await mkNode('person', 'vladimir-petrov', 'Vladimir Petrov', {
    nationality: 'ru',
    dateOfBirth: { month: 4, year: 1965 },
  }, 'CRITICAL', 0);
  await mkEdge(root.id, vladimir.id, 'director', { role: 'director', appointedOn: '2010-03-15' });

  // 18 active + 6 dissolved companies under Vladimir
  for (let i = 0; i < 18; i++) {
    const c = await mkNode('company', `VP-A-${i}`, `Petrov Capital ${i + 1} Ltd`, {
      status: 'active',
      incorporationDate: `202${i % 4}-0${(i % 9) + 1}-1${i % 9}`,
    }, 'HIGH', 1);
    await mkEdge(c.id, vladimir.id, 'director', { role: 'director' });
  }
  for (let i = 0; i < 6; i++) {
    const incDate = `2018-0${i + 1}-15`;
    const dissDate = `2019-0${i + 2}-15`;
    const c = await mkNode('company', `VP-D-${i}`, `Petrov Trading ${i + 1} Ltd`, {
      status: 'dissolved',
      incorporationDate: incDate,
      dissolutionDate: dissDate,
    }, 'HIGH', 1);
    await mkEdge(c.id, vladimir.id, 'director', { role: 'director', resignedOn: dissDate });
  }

  // Virtual office address (27 companies)
  const va = await mkNode('address', '1-suite-100-london-ec1a-1bb', 'Suite 100, 1 King\'s Road, London EC1A 1BB', {
    raw: { address_line_1: 'Suite 100, 1 King\'s Road', locality: 'London', postal_code: 'EC1A 1BB' },
    addressAnalysis: {
      density: 27, dissolved: 9, dissolutionRate: 0.33, averageLifespanYears: 2.1, flag: 'VIRTUAL_OFFICE',
    },
    companyCount: 27,
    suspicious: true,
  }, 'HIGH', 1);
  await mkEdge(root.id, va.id, 'address');
  for (let i = 0; i < 26; i++) {
    const c = await mkNode('company', `VA-${i}`, `Holdings ${i + 1} Ltd`, {
      status: i % 3 === 0 ? 'dissolved' : 'active',
      incorporationDate: `2022-0${(i % 9) + 1}-${(i % 27) + 1}`,
      ...(i % 3 === 0 && { dissolutionDate: `2023-0${(i % 9) + 1}-15` }),
    }, 'MEDIUM', 2);
    await mkEdge(c.id, va.id, 'address');
  }

  // ICIJ-matched offshore company
  const offshore = await mkNode('company', 'CY-998877', 'Petrov Holdings Cyprus Ltd', {
    status: 'active',
    incorporationDate: '2014-09-30',
    jurisdiction: 'CY',
  }, 'HIGH', 1);
  await mkEdge(offshore.id, vladimir.id, 'director', { role: 'director' });

  // Circular ownership: A -> B -> C -> A (psc edges: company source -> controller target)
  const cycA = await mkNode('company', 'CYC-A', 'Alpha Holdings Ltd', { status: 'active' }, 'MEDIUM', 2);
  const cycB = await mkNode('company', 'CYC-B', 'Beta Trading Ltd', { status: 'active' }, 'MEDIUM', 2);
  const cycC = await mkNode('company', 'CYC-C', 'Gamma Capital Ltd', { status: 'active' }, 'MEDIUM', 2);
  await mkEdge(cycA.id, cycC.id, 'psc', { naturesOfControl: ['ownership-of-shares-25-to-50-percent'] });
  await mkEdge(cycB.id, cycA.id, 'psc', { naturesOfControl: ['ownership-of-shares-25-to-50-percent'] });
  await mkEdge(cycC.id, cycB.id, 'psc', { naturesOfControl: ['ownership-of-shares-25-to-50-percent'] });
  await mkEdge(root.id, cycA.id, 'psc', { naturesOfControl: ['voting-rights-25-to-50-percent'] });

  // Mass incorporation cluster
  const massCompanies: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = await mkNode('company', `MASS-${i}`, `Quick Setup ${i + 1} Ltd`, {
      status: 'active',
      incorporationDate: `2024-01-${10 + i * 3}`,
    }, 'MEDIUM', 2);
    massCompanies.push(c.id);
    await mkEdge(c.id, vladimir.id, 'director', { role: 'director' });
  }

  // Sanctions match (OpenSanctions, 82% confidence)
  await matches.save(
    matches.create({
      investigationId: invId,
      sourceEntityType: 'person',
      sourceEntityId: 'vladimir-petrov',
      matchedSource: 'opensanctions',
      matchedEntityId: 'NK-sample-001',
      confidenceScore: 82,
      matchReasons: {
        exactName: true,
        phoneticMatch: true,
        jaroWinkler: '0.985',
        dobMatch: 1965,
        nationality: 'ru',
        matchedName: 'Vladimir Petrov',
        topics: ['sanction'],
      },
    }),
  );

  // ICIJ match
  await matches.save(
    matches.create({
      investigationId: invId,
      sourceEntityType: 'company',
      sourceEntityId: 'CY-998877',
      matchedSource: 'offshore_leaks',
      matchedEntityId: '80001',
      confidenceScore: 88,
      matchReasons: {
        exactName: true,
        jaroWinkler: '0.92',
        matchedName: 'Petrov Holdings Cyprus Ltd',
        jurisdiction: 'CY',
        sourceid: 'Panama Papers',
      },
    }),
  );

  // Build findings + risk score (matching what RiskScoringService would produce)
  const findings = [
    {
      type: 'circular_ownership',
      severity: 'CRITICAL',
      title: 'Circular ownership detected',
      description: 'Ownership loop spanning 3 entities.',
      evidence: ['Alpha Holdings Ltd → Beta Trading Ltd → Gamma Capital Ltd → Alpha Holdings Ltd'],
      affectedEntities: [cycA.id, cycB.id, cycC.id],
      recommendation: 'Trace ultimate beneficial owner; circular ownership is a strong obfuscation signal.',
    },
    {
      type: 'sanctions_match',
      severity: 'CRITICAL',
      title: 'OpenSanctions match (82%)',
      description: 'Vladimir Petrov matched against OpenSanctions sanctions list with 82% confidence.',
      evidence: ['exactName: true', 'phoneticMatch: true', 'jaroWinkler: 0.985', 'dobMatch: 1965', 'nationality: ru'],
      affectedEntities: ['vladimir-petrov'],
      recommendation: 'Immediate review required; halt onboarding/transactions pending verification.',
    },
    {
      type: 'shell_company',
      severity: 'HIGH',
      title: 'Shell company indicators: Petrov Holdings UK Ltd',
      description: 'Multi-factor shell-company score of 65 indicates high likelihood of being a shell entity.',
      evidence: [
        'Director "Vladimir Petrov" has 18 active companies',
        'Director "Vladimir Petrov" has 6 dissolved companies',
        'Registered at virtual office address shared by 27 companies',
        'Files dormant accounts',
      ],
      affectedEntities: ['12345678'],
      recommendation: 'Investigate filings, beneficial ownership, and economic substance.',
    },
    {
      type: 'virtual_office',
      severity: 'HIGH',
      title: 'Virtual office address',
      description: '27 companies registered at this address (dissolution rate 33%).',
      evidence: ['Address: Suite 100, 1 King\'s Road, London EC1A 1BB', 'Density: 27', 'Dissolved: 9'],
      affectedEntities: ['1-suite-100-london-ec1a-1bb'],
      recommendation: 'Investigate companies registered at this address for shared control.',
    },
    {
      type: 'sanctions_match',
      severity: 'HIGH',
      title: 'ICIJ match (88%)',
      description: 'Petrov Holdings Cyprus Ltd matched against ICIJ OffshoreLeaks (Panama Papers).',
      evidence: ['exactName: true', 'jurisdiction: CY', 'sourceid: Panama Papers'],
      affectedEntities: ['CY-998877'],
      recommendation: 'Verify match; document review and decision.',
    },
    {
      type: 'mass_incorporation',
      severity: 'MEDIUM',
      title: 'Mass incorporation: 5 companies',
      description: '5 companies incorporated between 2024-01-10 and 2024-01-22.',
      evidence: ['Window: 2024-01-10 → 2024-01-22', 'Companies: 5'],
      affectedEntities: massCompanies.map((id) => id),
      recommendation: 'Coordinated incorporation windows often indicate templated structures.',
    },
  ];

  const totalNodes = await nodes.count({ where: { investigationId: invId } });
  const totalEdges = await edges.count({ where: { investigationId: invId } });

  await inv.update(invId, {
    progress: {
      entitiesDiscovered: totalNodes,
      edgesCreated: totalEdges,
      apiCallsMade: 152,
      currentDepth: 2,
      riskScore: 72,
      findings,
    } as any,
  });

  console.log(`Demo seeded: ${totalNodes} nodes, ${totalEdges} edges, investigation id ${invId}`);
  await dataSource.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
