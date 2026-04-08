import { CompaniesHouseService } from './companies-house.service';

class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async setex(k: string, _t: number, v: string) { this.store.set(k, v); }
  async incr(_k: string) { return 1; }
  async expire(_k: string, _s: number) {}
}

class FakeLimiter { async acquire() {} }

function makeService(handler: (path: string) => Promise<any>) {
  const svc = new CompaniesHouseService(new FakeRedis() as any, new FakeLimiter() as any);
  svc.setHttpClient({ get: async (p: string) => handler(p) } as any);
  return svc;
}

describe('CompaniesHouseService', () => {
  it('getCompany returns company data', async () => {
    const svc = makeService(async (p) => {
      expect(p).toBe('/company/12345678');
      return { data: { company_name: 'Acme', company_number: '12345678' } };
    });
    const out = await svc.getCompany('12345678');
    expect(out.company_name).toBe('Acme');
  });

  it('getOfficers calls correct path', async () => {
    const svc = makeService(async (p) => {
      expect(p).toBe('/company/12345678/officers');
      return { data: { items: [{ name: 'Jane' }] } };
    });
    const out = await svc.getOfficers('12345678');
    expect(out.items).toHaveLength(1);
  });

  it('caches responses', async () => {
    let calls = 0;
    const svc = makeService(async () => { calls++; return { data: { x: 1 } }; });
    await svc.getCompany('1');
    await svc.getCompany('1');
    expect(calls).toBe(1);
  });

  it('retries on 503 then succeeds', async () => {
    let n = 0;
    const svc = makeService(async () => {
      n++;
      if (n < 2) {
        const e: any = new Error('503'); e.response = { status: 503 }; throw e;
      }
      return { data: { ok: true } };
    });
    // shrink retry sleep
    jest.spyOn(global, 'setTimeout' as any).mockImplementation((cb: any) => { cb(); return 0 as any; });
    const out = await svc.getCompany('retryco');
    expect(out.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('does not retry on 404', async () => {
    let n = 0;
    const svc = makeService(async () => {
      n++;
      const e: any = new Error('404'); e.response = { status: 404 }; throw e;
    });
    await expect(svc.getCompany('nope')).rejects.toBeDefined();
    expect(n).toBe(1);
  });
});
