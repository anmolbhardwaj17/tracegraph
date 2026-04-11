import { RiskScoringService } from './risk-scoring.service';
import { Finding } from './finding.types';

/**
 * Lightweight integration test: stubs every analyzer + repository, runs the
 * full scoring pipeline, and verifies that the synthesized findings carry
 * the expected shape and severity weights aggregate to the right score.
 */

class FakeRepo<T> {
  rows: T[] = [];
  async find(opts?: any): Promise<T[]> {
    if (!opts?.where) return this.rows;
    return this.rows.filter((r: any) => Object.entries(opts.where).every(([k, v]) => r[k] === v));
  }
  async findOne(opts: any): Promise<T | null> {
    return (await this.find(opts))[0] || null;
  }
  async save(entity: any) { return entity; }
  async update(_id: any, _patch: any) { return { affected: 1 }; }
}

describe('RiskScoringService integration', () => {
  it('aggregates findings from all analyzers into a final report', async () => {
    const nodes: any[] = [
      {
        id: 'n1', investigationId: 'inv', entityType: 'company', entityId: 'C1', label: 'Shell Co',
        metadata: {
          companyProfile: 'SMALL_PRIVATE',
          shellCompanyScore: { score: 65, risk: 'HIGH', reasons: ['Director has 15 active companies'] },
        },
      },
      {
        id: 'n2', investigationId: 'inv', entityType: 'address', entityId: 'A1', label: '1 Suite, EC1',
        metadata: { addressAnalysis: { density: 27, dissolved: 9, dissolutionRate: 0.5, classification: 'VIRTUAL_OFFICE', flag: 'VIRTUAL_OFFICE' } },
      },
      {
        id: 'n3', investigationId: 'inv', entityType: 'person', entityId: 'P1', label: 'Bridge Person',
        proximityScore: 'HIGH', proximityHops: 1,
      },
    ];
    const matches: any[] = [{
      investigationId: 'inv', sourceEntityType: 'person', sourceEntityId: 'P1',
      matchedSource: 'opensanctions', matchedEntityId: 'NK-x', confidenceScore: 92,
      matchReasons: { exactName: true, dobMatch: 1965 },
    }];

    const nodesRepo = new FakeRepo<any>(); nodesRepo.rows = nodes;
    const edgesRepo = new FakeRepo<any>();
    const invRepo = new FakeRepo<any>(); invRepo.rows = [{ id: 'inv', progress: {} }];
    const matchRepo = new FakeRepo<any>(); matchRepo.rows = matches;

    // Stub analyzers
    const stubAnomaly = { scoreShellCompanies: jest.fn().mockResolvedValue({ scored: 1, high: 1 }) };
    const stubAddr = { analyze: jest.fn().mockResolvedValue({ addresses: 1, flagged: 1 }) };
    const stubCycle = { detect: jest.fn().mockResolvedValue([{ nodeIds: ['A', 'B', 'C'], labels: ['A', 'B', 'C'] }]) };
    const stubComm = { detect: jest.fn().mockResolvedValue({ communities: [{ id: 0 }, { id: 1 }], bridges: [{ nodeId: 'n3', label: 'Bridge', betweenness: 4, bridgesCommunities: [0, 1] }] }) };
    const stubTemporal = { detect: jest.fn().mockResolvedValue({
      massIncorporation: [{ windowStart: '2024-01-01', windowEnd: '2024-01-30', companyIds: ['c1', 'c2', 'c3'] }],
      massDissolution: [],
      rapidDissolution: [],
      preEventResignations: [],
    }) };

    const stubClassifier = { classifyAll: jest.fn().mockResolvedValue({ classified: 1, byProfile: {} }) };
    const stubDirector = { profileAll: jest.fn().mockResolvedValue({ profiled: 0, flagged: 0 }) };
    const stubFilingHealth = { analyze: jest.fn().mockResolvedValue({ healthCount: 0, regressedCount: 0, cyclingCount: 0, phoenixPairs: [] }) };
    const stubDisqualified = { checkAll: jest.fn().mockResolvedValue([]) };
    const stubJurisdiction = { tagAll: jest.fn().mockResolvedValue({ tagged: 0, high: 0, medium: 0, chainsBoosted: 0 }) };
    const svc = new RiskScoringService(
      nodesRepo as any,
      edgesRepo as any,
      invRepo as any,
      matchRepo as any,
      stubClassifier as any,
      stubAnomaly as any,
      stubAddr as any,
      stubCycle as any,
      stubComm as any,
      stubTemporal as any,
      stubDirector as any,
      stubFilingHealth as any,
      stubDisqualified as any,
      stubJurisdiction as any, {} as any, {} as any, {} as any,
    );

    const result = await svc.run('inv');

    // All analyzers fired
    expect(stubAnomaly.scoreShellCompanies).toHaveBeenCalledWith('inv');
    expect(stubAddr.analyze).toHaveBeenCalledWith('inv');
    expect(stubCycle.detect).toHaveBeenCalledWith('inv');
    expect(stubComm.detect).toHaveBeenCalledWith('inv');
    expect(stubTemporal.detect).toHaveBeenCalledWith('inv');

    // Findings produced
    const types = result.findings.map((f) => f.type);
    expect(types).toContain('SHELL_NETWORK');
    expect(types).toContain('VIRTUAL_OFFICE_CLUSTER');
    expect(types).toContain('CIRCULAR_OWNERSHIP');
    expect(types).toContain('BRIDGE_PERSON');
    expect(types).toContain('MASS_INCORPORATION');
    expect(types).toContain('SANCTIONS_PROXIMITY');

    // Score capped at 100
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);

    // CRITICAL findings sorted to the front
    expect(result.findings[0].severity).toBe('CRITICAL');

    // Finding shape is consistent
    for (const f of result.findings) {
      expect(f).toEqual(
        expect.objectContaining({
          type: expect.any(String),
          severity: expect.stringMatching(/^(CRITICAL|HIGH|MEDIUM|LOW)$/),
          title: expect.any(String),
          description: expect.any(String),
          evidence: expect.any(Array),
          affectedEntities: expect.any(Array),
          recommendation: expect.any(String),
        }),
      );
    }
  });
});
