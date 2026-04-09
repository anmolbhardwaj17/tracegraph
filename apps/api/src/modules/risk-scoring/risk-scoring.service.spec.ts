import { RiskScoringService } from './risk-scoring.service';
import { Finding } from './finding.types';

describe('RiskScoringService.aggregateScore', () => {
  const svc = new RiskScoringService(
    {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  const f = (severity: Finding['severity']): Finding => ({
    type: 't', severity, title: '', description: '', evidence: [],
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
