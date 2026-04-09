import { InvestigationService } from './investigation.service';

class FakeRepo<T> {
  rows: T[] = [];
  async find(opts?: any): Promise<T[]> {
    if (!opts?.where) {
      const list = [...this.rows];
      if (opts?.order?.createdAt === 'DESC') list.sort((a: any, b: any) => b.createdAt - a.createdAt);
      return opts?.take ? list.slice(0, opts.take) : list;
    }
    return this.rows.filter((r: any) => Object.entries(opts.where).every(([k, v]) => r[k] === v));
  }
  async findOne(opts: any): Promise<T | null> {
    return (await this.find(opts))[0] || null;
  }
  async save(entity: any) { return entity; }
  create(entity: any) { return entity; }
}

class FakeQueue {
  added: any[] = [];
  async add(name: string, data: any) { this.added.push({ name, data }); }
}

describe('InvestigationService', () => {
  function makeService() {
    const inv = new FakeRepo<any>();
    const nodes = new FakeRepo<any>();
    const edges = new FakeRepo<any>();
    const matches = new FakeRepo<any>();
    const queue = new FakeQueue();
    const svc = new InvestigationService(
      inv as any, nodes as any, edges as any, matches as any, queue as any,
    );
    return { svc, inv, nodes, edges, matches, queue };
  }

  it('list returns recent investigations with risk score', async () => {
    const { svc, inv } = makeService();
    inv.rows = [
      { id: '1', query: 'Acme', status: 'COMPLETE', createdAt: 1, progress: { riskScore: 42 } },
      { id: '2', query: 'Beta', status: 'EXPANDING', createdAt: 2, progress: { entitiesDiscovered: 10 } },
    ];
    const result = await svc.list();
    expect(result).toHaveLength(2);
    const withRisk = result.find((r) => r.riskScore !== undefined);
    const withCounts = result.find((r) => r.counts !== undefined);
    expect(withRisk?.riskScore).toBe(42);
    expect(withCounts?.counts).toBeDefined();
  });

  it('graphFor returns nodes with degree, links with type, and match flags', async () => {
    const { svc, nodes, edges, matches } = makeService();
    nodes.rows = [
      { id: 'n1', investigationId: 'inv', entityType: 'company', entityId: 'C1', label: 'Acme', metadata: {} },
      { id: 'n2', investigationId: 'inv', entityType: 'person', entityId: 'P1', label: 'Jane', metadata: {} },
    ];
    edges.rows = [
      { id: 'e1', investigationId: 'inv', sourceNodeId: 'n1', targetNodeId: 'n2', relationshipType: 'director' },
    ];
    matches.rows = [
      { investigationId: 'inv', sourceEntityId: 'P1' },
    ];

    const result = await svc.graphFor('inv');
    expect(result.nodes).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(result.nodes[0].degree).toBe(1);
    expect(result.nodes[1].degree).toBe(1);
    expect(result.nodes[1].hasMatch).toBe(true);
    expect(result.nodes[0].hasMatch).toBe(false);
    expect(result.links[0].type).toBe('director');
  });

  it('create enqueues a job', async () => {
    const { svc, queue, inv } = makeService();
    inv.rows = [];
    const created = await svc.create('Acme Co');
    expect(queue.added).toHaveLength(1);
    expect(queue.added[0].name).toBe('expand');
    expect(created.query).toBe('Acme Co');
  });

  it('findOne throws NotFound when missing', async () => {
    const { svc } = makeService();
    await expect(svc.findOne('does-not-exist')).rejects.toThrow();
  });
});
