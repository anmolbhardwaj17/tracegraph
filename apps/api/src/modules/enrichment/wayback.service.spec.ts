import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WaybackService } from './wayback.service';
import { GraphNode } from '../graph/entities/graph-node.entity';

describe('WaybackService', () => {
  let service: WaybackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaybackService,
        { provide: getRepositoryToken(GraphNode), useValue: { findOne: jest.fn().mockResolvedValue(null), update: jest.fn() } },
      ],
    }).compile();
    service = module.get(WaybackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should extract domain from URL', () => {
    const extract = (service as any).extractDomain.bind(service);
    expect(extract('https://www.amazon.com')).toBe('amazon.com');
    expect(extract('https://apple.com/store')).toBe('apple.com');
    expect(extract('http://www.example.co.uk')).toBe('www.example.co.uk');
    expect(extract(null)).toBeNull();
  });

  it('should guess domain from company name', () => {
    const guess = (service as any).guessDomain.bind(service);
    expect(guess('Apple Inc')).toBe('apple.com');
    expect(guess('Microsoft Corp')).toBe('microsoft.com');
    expect(guess('AB')).toBeNull(); // too short
  });

  it('should generate findings for missing web history', () => {
    const gen = (service as any).generateFindings.bind(service);
    const result = { domain: 'test.com', exists: false, firstSnapshot: null, lastSnapshot: null, totalSnapshots: 0, domainAgeYears: null, flags: ['NO_WEB_ARCHIVE'] };
    const findings = gen('Test Corp', result, null);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].type).toBe('NO_WEB_HISTORY');
  });

  it('should flag website age mismatch', () => {
    const gen = (service as any).generateFindings.bind(service);
    const result = { domain: 'test.com', exists: true, firstSnapshot: '2025-01-01', lastSnapshot: '2025-06-01', totalSnapshots: 5, domainAgeYears: 1.5, flags: ['WEBSITE_UNDER_1_YEAR'] };
    const findings = gen('Old Corp', result, '2010-01-01');
    const mismatch = findings.find((f: any) => f.type === 'WEBSITE_AGE_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe('HIGH');
  });

  it('should not flag when ages match', () => {
    const gen = (service as any).generateFindings.bind(service);
    const result = { domain: 'test.com', exists: true, firstSnapshot: '2015-01-01', lastSnapshot: '2025-06-01', totalSnapshots: 500, domainAgeYears: 11, flags: [] };
    const findings = gen('Normal Corp', result, '2014-06-01');
    const mismatch = findings.find((f: any) => f.type === 'WEBSITE_AGE_MISMATCH');
    expect(mismatch).toBeUndefined();
  });
});
