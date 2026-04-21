import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SanctionsDirectService } from './sanctions-direct.service';
import { GraphNode } from '../graph/entities/graph-node.entity';

describe('SanctionsDirectService', () => {
  let service: SanctionsDirectService;

  const mockNodeRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SanctionsDirectService,
        { provide: getRepositoryToken(GraphNode), useValue: mockNodeRepo },
      ],
    }).compile();

    service = module.get<SanctionsDirectService>(SanctionsDirectService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should screen entities and return results', async () => {
    mockNodeRepo.find.mockResolvedValue([
      { id: '1', entityType: 'person', entityId: 'p-1', label: 'John Smith', metadata: {} },
      { id: '2', entityType: 'company', entityId: 'c-1', label: 'Acme Corp', metadata: {} },
    ]);
    mockNodeRepo.findOne.mockResolvedValue(null);

    // This will try to load OFAC/UK HMT lists — may timeout in test
    // The test validates the service doesn't crash, not that it matches
    const result = await service.screen('test-inv-id');

    expect(result).toBeDefined();
    expect(result.matches).toBeDefined();
    expect(result.findings).toBeDefined();
    expect(Array.isArray(result.matches)).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
  }, 60000); // 60s timeout for list download

  it('should handle empty entity list', async () => {
    mockNodeRepo.find.mockResolvedValue([]);

    const result = await service.screen('test-inv-id');

    expect(result.matches).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});
