import { RiskScoringService } from './risk-scoring.service';
import { Finding, classifyOverall } from './finding.types';

describe('RiskScoringService.aggregateScore (legacy weight sum)', () => {
  const svc = new RiskScoringService(
    {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  const f = (severity: Finding['severity']): Finding => ({
    type: 't', severity, confidence: 'MEDIUM', title: '', description: '', evidence: [],
    affectedEntities: [], recommendation: '',
  });

  it('caps at 100', () => {
    const findings = Array.from({ length: 10 }, () => f('CRITICAL'));
    expect(svc.aggregateScore(findings)).toBe(100);
  });

  it('weights severities', () => {
    expect(svc.aggregateScore([f('CRITICAL')])).toBe(25);
    expect(svc.aggregateScore([f('HIGH')])).toBe(15);
    expect(svc.aggregateScore([f('MEDIUM')])).toBe(8);
    expect(svc.aggregateScore([f('LOW')])).toBe(3);
  });

  it('returns 0 for no findings', () => {
    expect(svc.aggregateScore([])).toBe(0);
  });

  it('sums mixed severities', () => {
    expect(svc.aggregateScore([f('CRITICAL'), f('HIGH'), f('MEDIUM')])).toBe(48);
  });
});

describe('classifyOverall', () => {
  it('maps score ranges to severities', () => {
    expect(classifyOverall(0)).toBe('LOW');
    expect(classifyOverall(24)).toBe('LOW');
    expect(classifyOverall(25)).toBe('MEDIUM');
    expect(classifyOverall(49)).toBe('MEDIUM');
    expect(classifyOverall(50)).toBe('HIGH');
    expect(classifyOverall(74)).toBe('HIGH');
    expect(classifyOverall(75)).toBe('CRITICAL');
    expect(classifyOverall(100)).toBe('CRITICAL');
  });
});

describe('RiskScoringService.calculateScore (component model)', () => {
  const svc = new RiskScoringService(
    {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  function profile(p: string) {
    return { metadata: { companyProfile: p } } as any;
  }

  it('LARGE_PUBLIC with no signals scores LOW', () => {
    const score = svc.calculateScore({
      matches: [],
      nodes: [profile('LARGE_PUBLIC')],
      cycles: [],
      temporal: { massIncorporation: [], rapidDissolution: [] },
    });
    expect(score).toBe(0);
    expect(classifyOverall(score)).toBe('LOW');
  });

  it('Direct OpenSanctions match (>80%) maxes the sanctions component', () => {
    const score = svc.calculateScore({
      matches: [{ matchedSource: 'opensanctions', confidenceScore: 92 } as any],
      nodes: [],
      cycles: [],
      temporal: { massIncorporation: [], rapidDissolution: [] },
    });
    expect(score).toBeGreaterThanOrEqual(40);
  });

  it('Circular ownership + shell network + nominee director → HIGH or CRITICAL', () => {
    const nodes: any[] = [
      { entityType: 'company', metadata: { companyProfile: 'SMALL_PRIVATE', shellCompanyScore: { risk: 'HIGH' } } },
      { entityType: 'person', metadata: { directorProfile: { risk: 'NOMINEE_PATTERN' } } },
    ];
    const score = svc.calculateScore({
      matches: [],
      nodes,
      cycles: [{ nodeIds: ['a', 'b', 'c'] }],
      temporal: { massIncorporation: [], rapidDissolution: [] },
    });
    expect(score).toBeGreaterThanOrEqual(50);
    expect(['HIGH', 'CRITICAL']).toContain(classifyOverall(score));
  });

  it('FORMATION_AGENT director alone contributes 25 to director component', () => {
    const score = svc.calculateScore({
      matches: [],
      nodes: [{ entityType: 'person', metadata: { directorProfile: { risk: 'FORMATION_AGENT' } } } as any],
      cycles: [],
      temporal: { massIncorporation: [], rapidDissolution: [] },
    });
    expect(score).toBe(25);
  });
});
