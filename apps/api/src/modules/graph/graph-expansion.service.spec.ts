import { GraphExpansionService } from './graph-expansion.service';

class FakeRepo<T extends { id?: string }> {
  rows: T[] = [];
  private seq = 0;
  create(input: any): T { return { ...input } as T; }
  async save(entity: any): Promise<T> {
    if (!entity.id) entity.id = `id-${++this.seq}`;
    // upsert by reference
    const existing = this.rows.find((r: any) => r.id === entity.id);
    if (existing) Object.assign(existing, entity);
    else this.rows.push(entity);
    return entity;
  }
  async findOne(opts: any): Promise<T | null> {
    const w = opts.where;
    return (
      this.rows.find((r: any) =>
        Object.entries(w).every(([k, v]) => r[k] === v),
      ) || null
    );
  }
}

const company = (number: string, name: string, address?: any) => ({
  company_number: number,
  company_name: name,
  company_status: 'active',
  date_of_creation: '2020-01-01',
  type: 'ltd',
  registered_office_address: address,
});

const officersResp = (items: any[], total = items.length) => ({
  total_results: total,
  items,
});

function makeFakeCH(graph: {
  companies: Record<string, any>;
  officers: Record<string, any[]>; // companyNumber -> officer items
  appointments: Record<string, any[]>; // officerExtId -> appointment items
  pscs?: Record<string, any[]>;
}) {
  return {
    async getCompany(n: string) {
      if (!graph.companies[n]) throw new Error(`no company ${n}`);
      return graph.companies[n];
    },
    async getOfficers(n: string) {
      return officersResp(graph.officers[n] || []);
    },
    async getPSC(n: string) {
      return { items: graph.pscs?.[n] || [] };
    },
    async getOfficerAppointments(id: string) {
      return { items: graph.appointments[id] || [] };
    },
  } as any;
}

function makeService(ch: any) {
  const nodes = new FakeRepo<any>();
  const edges = new FakeRepo<any>();
  const svc = new GraphExpansionService(nodes as any, edges as any, ch);
  return { svc, nodes, edges };
}

const officer = (id: string, name: string) => ({
  name,
  links: { officer: { appointments: `/officers/${id}/appointments` } },
  officer_role: 'director',
});

describe('GraphExpansionService', () => {
  it('expands one level: root + officers', async () => {
    const ch = makeFakeCH({
      companies: { ROOT: company('ROOT', 'Root Co') },
      officers: { ROOT: [officer('jane', 'Jane Doe')] },
      appointments: { jane: [] },
    });
    const { svc, nodes, edges } = makeService(ch);
    const result = await svc.expand('inv1', 'ROOT', { maxCompanyDepth: 1 });

    const labels = nodes.rows.map((n) => n.label).sort();
    expect(labels).toEqual(['Jane Doe', 'Root Co']);
    expect(edges.rows).toHaveLength(1);
    expect(edges.rows[0].relationshipType).toBe('director');
    expect(result.entitiesDiscovered).toBe(2);
    expect(result.edgesCreated).toBe(1);
  });

  it('follows officer to their other appointments (depth 2)', async () => {
    const ch = makeFakeCH({
      companies: {
        ROOT: company('ROOT', 'Root Co'),
        OTHER: company('OTHER', 'Other Co'),
      },
      officers: {
        ROOT: [officer('jane', 'Jane')],
        OTHER: [],
      },
      appointments: {
        jane: [{ appointed_to: { company_number: 'OTHER', company_name: 'Other Co' }, officer_role: 'director' }],
      },
    });
    const { svc, nodes } = makeService(ch);
    await svc.expand('inv1', 'ROOT', { maxCompanyDepth: 2 });

    const companies = nodes.rows.filter((n) => n.entityType === 'company').map((n) => n.entityId).sort();
    expect(companies).toEqual(['OTHER', 'ROOT']);
  });

  it('detects cycles: same company reached twice is not refetched', async () => {
    let rootFetches = 0;
    const ch: any = {
      async getCompany(n: string) {
        if (n === 'ROOT') rootFetches++;
        return company(n, n);
      },
      async getOfficers(n: string) {
        if (n === 'ROOT') return officersResp([officer('jane', 'Jane')]);
        return officersResp([officer('jane', 'Jane')]); // same officer
      },
      async getPSC() { return { items: [] }; },
      async getOfficerAppointments() {
        return { items: [{ appointed_to: { company_number: 'ROOT' }, officer_role: 'director' }] };
      },
    };
    const { svc } = makeService(ch);
    await svc.expand('inv1', 'ROOT', { maxCompanyDepth: 3 });
    expect(rootFetches).toBe(1);
  });

  it('skips expansion of companies with > 100 officers', async () => {
    const manyOfficers = Array.from({ length: 150 }, (_, i) => officer(`o${i}`, `Officer ${i}`));
    let appointmentCalls = 0;
    const ch: any = {
      async getCompany(n: string) { return company(n, n); },
      async getOfficers() { return officersResp(manyOfficers, 150); },
      async getPSC() { return { items: [] }; },
      async getOfficerAppointments() { appointmentCalls++; return { items: [] }; },
    };
    const { svc, nodes } = makeService(ch);
    await svc.expand('inv1', 'BIG', { maxCompanyDepth: 2, largeCompanyOfficerThreshold: 100 });
    // Officers still recorded as nodes, but their appointments are not fetched
    expect(appointmentCalls).toBe(0);
    expect(nodes.rows.filter((n) => n.entityType === 'person')).toHaveLength(150);
  });

  it('deduplicates company nodes reached via two different directors', async () => {
    const ch = makeFakeCH({
      companies: {
        ROOT: company('ROOT', 'Root'),
        SHARED: company('SHARED', 'Shared'),
      },
      officers: {
        ROOT: [officer('a', 'Alice'), officer('b', 'Bob')],
        SHARED: [],
      },
      appointments: {
        a: [{ appointed_to: { company_number: 'SHARED' }, officer_role: 'director' }],
        b: [{ appointed_to: { company_number: 'SHARED' }, officer_role: 'director' }],
      },
    });
    const { svc, nodes } = makeService(ch);
    await svc.expand('inv1', 'ROOT', { maxCompanyDepth: 2 });
    const sharedNodes = nodes.rows.filter((n) => n.entityType === 'company' && n.entityId === 'SHARED');
    expect(sharedNodes).toHaveLength(1);
  });

  it('shares one address node across multiple companies (reverse lookup)', async () => {
    const addr = {
      address_line_1: '1 Main St',
      locality: 'London',
      postal_code: 'SW1A 1AA',
    };
    const ch = makeFakeCH({
      companies: {
        ROOT: company('ROOT', 'Root', addr),
        OTHER: company('OTHER', 'Other', addr),
      },
      officers: {
        ROOT: [officer('a', 'Alice')],
        OTHER: [],
      },
      appointments: {
        a: [{ appointed_to: { company_number: 'OTHER' }, officer_role: 'director' }],
      },
    });
    const { svc, nodes, edges } = makeService(ch);
    await svc.expand('inv1', 'ROOT', { maxCompanyDepth: 2, maxAddressDepth: 2 });
    const addrNodes = nodes.rows.filter((n) => n.entityType === 'address');
    expect(addrNodes).toHaveLength(1);
    const addrEdges = edges.rows.filter((e) => e.relationshipType === 'address');
    expect(addrEdges).toHaveLength(2);
  });

  it('emits onEntityDiscovered and onProgress callbacks', async () => {
    const ch = makeFakeCH({
      companies: { ROOT: company('ROOT', 'Root') },
      officers: { ROOT: [officer('jane', 'Jane')] },
      appointments: { jane: [] },
    });
    const { svc } = makeService(ch);
    const discovered: string[] = [];
    const progress: any[] = [];
    await svc.expand('inv1', 'ROOT', { maxCompanyDepth: 1 }, {
      onEntityDiscovered: (n) => discovered.push(n.label),
      onProgress: (p) => progress.push({ ...p }),
    });
    expect(discovered).toContain('Root');
    expect(discovered).toContain('Jane');
    expect(progress.length).toBeGreaterThan(0);
  });
});
