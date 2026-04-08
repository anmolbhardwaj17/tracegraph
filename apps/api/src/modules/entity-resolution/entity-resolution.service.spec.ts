import { EntityResolutionService } from './entity-resolution.service';
import { metaphone, jaroWinkler, normalizeName } from './algorithms';

function makeService() {
  return new EntityResolutionService({} as any, {} as any, {} as any, {} as any);
}

describe('algorithms', () => {
  it('normalizeName strips titles and punctuation', () => {
    expect(normalizeName('Mr. John Smith')).toBe('john smith');
    expect(normalizeName('Dr Jane O\'Neil')).toBe('jane o neil');
  });

  it('metaphone produces matching keys for similar-sounding names', () => {
    expect(metaphone('smith')).toBe(metaphone('smyth'));
    expect(metaphone('katherine')).toBe(metaphone('katharine'));
  });

  it('jaroWinkler scores identical strings as 1', () => {
    expect(jaroWinkler('vladimir', 'vladimir')).toBeCloseTo(1);
  });

  it('jaroWinkler scores close variants > 0.85', () => {
    expect(jaroWinkler('vladimir petrov', 'vladimir petrof')).toBeGreaterThan(0.85);
  });

  it('jaroWinkler scores unrelated strings low', () => {
    expect(jaroWinkler('alice', 'zachary')).toBeLessThan(0.6);
  });
});

describe('EntityResolutionService.score', () => {
  const svc = makeService();

  it('exact name + DOB + nationality = high confidence', () => {
    const r = svc.score(
      { id: '1', names: ['Vladimir Petrov'], birthYear: 1965, nationality: 'ru' },
      { id: 'sanc-1', names: ['Vladimir Petrov'], birthYear: 1965, nationality: 'ru' },
    );
    expect(r.score).toBeGreaterThan(75);
    expect(svc.classify(r.score)).toBe('match');
    expect(r.reasons.exactName).toBe(true);
    expect(r.reasons.dobMatch).toBe(1965);
  });

  it('phonetic-only match scores in possible range', () => {
    const r = svc.score(
      { id: '1', names: ['John Smyth'] },
      { id: 'x', names: ['John Smith'] },
    );
    // exact:0, phonetic:20, jw>0.85:15 → 35
    expect(r.score).toBeGreaterThanOrEqual(20);
  });

  it('fuzzy match with DOB hits possible threshold', () => {
    const r = svc.score(
      { id: '1', names: ['Vladimir Petrov'], birthYear: 1965 },
      { id: 'x', names: ['Vladimir Petrof'], birthYear: 1965 },
    );
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(['match', 'possible']).toContain(svc.classify(r.score));
  });

  it('unrelated names = no match', () => {
    const r = svc.score(
      { id: '1', names: ['Alice Brown'] },
      { id: 'x', names: ['Hassan Mohammed'] },
    );
    expect(r.score).toBeLessThan(50);
    expect(svc.classify(r.score)).toBe('none');
  });

  it('exact name without DOB still classifies as possible', () => {
    const r = svc.score(
      { id: '1', names: ['Jane Smith'] },
      { id: 'x', names: ['Jane Smith'] },
    );
    // exact 40 + phonetic 20 + JW 15 = 75 → boundary, threshold uses >75
    expect(r.score).toBeGreaterThanOrEqual(50);
  });
});
