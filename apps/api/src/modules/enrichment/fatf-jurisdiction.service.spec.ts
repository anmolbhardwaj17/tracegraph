import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FatfJurisdictionService } from './fatf-jurisdiction.service';
import { GraphNode } from '../graph/entities/graph-node.entity';

describe('FatfJurisdictionService', () => {
  let service: FatfJurisdictionService;

  const mockNodeRepo = {
    find: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FatfJurisdictionService,
        { provide: getRepositoryToken(GraphNode), useValue: mockNodeRepo },
      ],
    }).compile();

    service = module.get<FatfJurisdictionService>(FatfJurisdictionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should flag FATF blacklisted jurisdictions', async () => {
    mockNodeRepo.find.mockResolvedValue([
      { id: '1', entityType: 'company', metadata: { jurisdiction: 'North Korea' } },
      { id: '2', entityType: 'company', metadata: { jurisdiction: 'United Kingdom' } },
    ]);
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.analyze('test-inv-id');

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    const nkResult = result.results.find((r) => r.jurisdiction === 'north korea');
    expect(nkResult).toBeDefined();
    expect(nkResult?.risk).toBe('BLACKLISTED');

    const findings = result.findings;
    expect(findings.some((f) => f.type === 'FATF_BLACKLIST')).toBe(true);
  });

  it('should flag secrecy jurisdictions', async () => {
    mockNodeRepo.find.mockResolvedValue([
      { id: '1', entityType: 'company', metadata: { jurisdiction: 'Cayman Islands' } },
      { id: '2', entityType: 'company', metadata: { jurisdiction: 'Luxembourg' } },
    ]);
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.analyze('test-inv-id');

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    const caymanResult = result.results.find((r) => r.jurisdiction === 'cayman islands');
    expect(caymanResult).toBeDefined();
    expect(caymanResult?.lists).toContain('Secrecy / Tax Haven Jurisdiction');
  });

  it('should not flag standard jurisdictions', async () => {
    mockNodeRepo.find.mockResolvedValue([
      { id: '1', entityType: 'company', metadata: { jurisdiction: 'United States' } },
      { id: '2', entityType: 'company', metadata: { jurisdiction: 'Germany' } },
    ]);
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.analyze('test-inv-id');

    expect(result.results.length).toBe(0);
    expect(result.findings.length).toBe(0);
  });

  it('should handle companies with no jurisdiction', async () => {
    mockNodeRepo.find.mockResolvedValue([
      { id: '1', entityType: 'company', metadata: {} },
      { id: '2', entityType: 'company', metadata: { jurisdiction: '' } },
    ]);
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.analyze('test-inv-id');
    expect(result.results.length).toBe(0);
  });
});
