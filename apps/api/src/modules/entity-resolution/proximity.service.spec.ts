import { SanctionsProximityService } from './proximity.service';

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

describe('SanctionsProximityService', () => {
  function makeSvc(nodes: any[], edges: any[], matches: any[]) {
    const nodesRepo = new FakeRepo<any>(); nodesRepo.rows = nodes;
    const edgesRepo = new FakeRepo<any>(); edgesRepo.rows = edges;
    const matchesRepo = new FakeRepo<any>(); matchesRepo.rows = matches;
    return new SanctionsProximityService(nodesRepo as any, edgesRepo as any, matchesRepo as any);
  }

  it('classifies hops correctly', () => {
    const svc = makeSvc([], [], []);
    expect(svc.classify(0)).toBe('CRITICAL');
    expect(svc.classify(1)).toBe('HIGH');
    expect(svc.classify(2)).toBe('MEDIUM');
    expect(svc.classify(3)).toBe('LOW');
    expect(svc.classify(undefined)).toBe('CLEAR');
  });

  it('marks directly matched nodes as CRITICAL', async () => {
    const nodes: any[] = [
      { id: 'n1', investigationId: 'inv', entityType: 'person', entityId: 'p1', label: 'p1' },
    ];
    const matches = [{
      investigationId: 'inv',
      sourceEntityId: 'p1',
      matchedSource: 'opensanctions',
    }];
    const svc = makeSvc(nodes, [], matches);
    const r = await svc.compute('inv');
    expect(nodes[0].proximityScore).toBe('CRITICAL');
    expect(r.flagged).toBe(1);
  });

  it('computes 1-hop HIGH and 2-hop MEDIUM via BFS', async () => {
    // Graph: sanctioned p1 — c1 — p2
    const nodes: any[] = [
      { id: 'n1', investigationId: 'inv', entityType: 'person', entityId: 'p1', label: 'p1' },
      { id: 'n2', investigationId: 'inv', entityType: 'company', entityId: 'c1', label: 'c1' },
      { id: 'n3', investigationId: 'inv', entityType: 'person', entityId: 'p2', label: 'p2' },
    ];
    const edges = [
      { investigationId: 'inv', sourceNodeId: 'n1', targetNodeId: 'n2' },
      { investigationId: 'inv', sourceNodeId: 'n2', targetNodeId: 'n3' },
    ];
    const matches = [{ investigationId: 'inv', sourceEntityId: 'p1', matchedSource: 'opensanctions' }];
    const svc = makeSvc(nodes, edges, matches);
    await svc.compute('inv');
    expect(nodes[0].proximityScore).toBe('CRITICAL');
    expect(nodes[1].proximityScore).toBe('HIGH');
    expect(nodes[2].proximityScore).toBe('MEDIUM');
  });

  it('returns CLEAR for disconnected nodes', async () => {
    const nodes: any[] = [
      { id: 'n1', investigationId: 'inv', entityType: 'person', entityId: 'p1', label: 'p1' },
      { id: 'n2', investigationId: 'inv', entityType: 'person', entityId: 'p2', label: 'p2' },
    ];
    // No matches at all
    const svc = makeSvc(nodes, [], []);
    await svc.compute('inv');
    expect(nodes[0].proximityScore).toBe('CLEAR');
    expect(nodes[1].proximityScore).toBe('CLEAR');
  });
});
