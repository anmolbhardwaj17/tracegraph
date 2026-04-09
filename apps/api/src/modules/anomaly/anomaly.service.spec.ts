import { AnomalyDetectionService } from './anomaly.service';
import { OwnershipCycleService } from './ownership-cycle.service';
import { TemporalAnomalyService } from './temporal-anomaly.service';

class FakeRepo<T> {
  rows: T[] = [];
  async find(opts?: any): Promise<T[]> {
    if (!opts?.where) return this.rows;
    return this.rows.filter((r: any) =>
      Object.entries(opts.where).every(([k, v]) => r[k] === v),
    );
  }
  async save(entity: any) { return entity; }
}

function makeNode(id: string, type: string, label: string, metadata: any = {}): any {
  return { id, investigationId: 'inv', entityType: type, entityId: id, label, metadata };
}
function makeEdge(src: string, tgt: string, rel: string, metadata: any = {}): any {
  return { investigationId: 'inv', sourceNodeId: src, targetNodeId: tgt, relationshipType: rel, metadata };
}

describe('AnomalyDetectionService - shell company scoring', () => {
  it('flags HIGH when director has 10+ active companies and shared address', async () => {
    const nodes: any[] = [makeNode('c-target', 'company', 'Target Co', {
      status: 'active',
      accountsType: 'dormant',
      incorporationDate: '2022-01-01',
      dissolutionDate: '2023-06-01',
    })];
    const edges: any[] = [];
    const personId = 'p1';
    nodes.push(makeNode(personId, 'person', 'Suspicious Director'));
    edges.push(makeEdge('c-target', personId, 'director'));
    // Person has 10 other active companies
    for (let i = 0; i < 10; i++) {
      const cid = `c-other-${i}`;
      nodes.push(makeNode(cid, 'company', `Other ${i}`, { status: 'active' }));
      edges.push(makeEdge(cid, personId, 'director'));
    }
    // Shared address used by 25 companies
    const addrId = 'addr1';
    nodes.push(makeNode(addrId, 'address', '1 Virtual Office'));
    for (let i = 0; i < 25; i++) {
      const cid = `c-va-${i}`;
      nodes.push(makeNode(cid, 'company', `VA ${i}`, { status: 'active' }));
      edges.push(makeEdge(cid, addrId, 'address'));
    }
    edges.push(makeEdge('c-target', addrId, 'address'));

    const nodesRepo = new FakeRepo<any>(); nodesRepo.rows = nodes;
    const edgesRepo = new FakeRepo<any>(); edgesRepo.rows = edges;
    const svc = new AnomalyDetectionService(nodesRepo as any, edgesRepo as any);
    await svc.scoreShellCompanies('inv');

    const target = nodes.find((n) => n.id === 'c-target');
    expect(target.metadata.shellCompanyScore.risk).toBe('HIGH');
    expect(target.metadata.shellCompanyScore.score).toBeGreaterThan(50);
  });

  it('LOW for clean company with no signals', async () => {
    const nodes: any[] = [
      makeNode('c1', 'company', 'Clean Co', { status: 'active' }),
      makeNode('p1', 'person', 'Single Director'),
    ];
    const edges: any[] = [makeEdge('c1', 'p1', 'director')];
    const nodesRepo = new FakeRepo<any>(); nodesRepo.rows = nodes;
    const edgesRepo = new FakeRepo<any>(); edgesRepo.rows = edges;
    const svc = new AnomalyDetectionService(nodesRepo as any, edgesRepo as any);
    await svc.scoreShellCompanies('inv');
    expect(nodes[0].metadata.shellCompanyScore.risk).toBe('LOW');
  });
});

describe('OwnershipCycleService', () => {
  it('detects a 3-entity ownership cycle', async () => {
    // A controls B, B controls C, C controls A
    // PSC edge: company (source) -> controller (target). So edges:
    //   B->A, C->B, A->C
    const nodes: any[] = [
      makeNode('A', 'company', 'A'),
      makeNode('B', 'company', 'B'),
      makeNode('C', 'company', 'C'),
    ];
    const edges: any[] = [
      makeEdge('B', 'A', 'psc'),
      makeEdge('C', 'B', 'psc'),
      makeEdge('A', 'C', 'psc'),
    ];
    const nodesRepo = new FakeRepo<any>(); nodesRepo.rows = nodes;
    const edgesRepo = new FakeRepo<any>(); edgesRepo.rows = edges;
    const svc = new OwnershipCycleService(nodesRepo as any, edgesRepo as any);
    const cycles = await svc.detect('inv');
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0].labels).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('returns empty when no cycle exists', async () => {
    const nodes: any[] = [
      makeNode('A', 'company', 'A'),
      makeNode('B', 'company', 'B'),
    ];
    const edges: any[] = [makeEdge('B', 'A', 'psc')];
    const nodesRepo = new FakeRepo<any>(); nodesRepo.rows = nodes;
    const edgesRepo = new FakeRepo<any>(); edgesRepo.rows = edges;
    const svc = new OwnershipCycleService(nodesRepo as any, edgesRepo as any);
    expect(await svc.detect('inv')).toEqual([]);
  });
});

describe('TemporalAnomalyService', () => {
  function svc(nodes: any[], edges: any[]) {
    const n = new FakeRepo<any>(); n.rows = nodes;
    const e = new FakeRepo<any>(); e.rows = edges;
    return new TemporalAnomalyService(n as any, e as any);
  }

  it('detects mass incorporation within 30 days', async () => {
    const nodes = [
      makeNode('c1', 'company', 'A', { incorporationDate: '2023-01-01' }),
      makeNode('c2', 'company', 'B', { incorporationDate: '2023-01-10' }),
      makeNode('c3', 'company', 'C', { incorporationDate: '2023-01-20' }),
    ];
    const r = await svc(nodes, []).detect('inv');
    expect(r.massIncorporation).toHaveLength(1);
    expect(r.massIncorporation[0].companyIds).toHaveLength(3);
  });

  it('detects rapid dissolution under 18 months', async () => {
    const nodes = [
      makeNode('c1', 'company', 'Quick', {
        incorporationDate: '2022-01-01',
        dissolutionDate: '2023-01-01',
      }),
    ];
    const r = await svc(nodes, []).detect('inv');
    expect(r.rapidDissolution).toHaveLength(1);
    expect(r.rapidDissolution[0].lifespanMonths).toBeLessThan(18);
  });

  it('detects pre-event resignation cluster', async () => {
    const nodes = [
      makeNode('p1', 'person', 'Director'),
      makeNode('c1', 'company', 'A'),
      makeNode('c2', 'company', 'B'),
      makeNode('c3', 'company', 'C'),
    ];
    const edges = [
      makeEdge('c1', 'p1', 'director', { resignedOn: '2024-01-01' }),
      makeEdge('c2', 'p1', 'director', { resignedOn: '2024-01-15' }),
      makeEdge('c3', 'p1', 'director', { resignedOn: '2024-02-10' }),
    ];
    const r = await svc(nodes, edges).detect('inv');
    expect(r.preEventResignations).toHaveLength(1);
    expect(r.preEventResignations[0].resignations).toBe(3);
  });
});
