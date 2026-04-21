import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnrichmentService } from './enrichment.service';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { GeocodingService } from '../geocoding/geocoding.service';

describe('EnrichmentService', () => {
  let service: EnrichmentService;
  let nodeRepo: jest.Mocked<Repository<GraphNode>>;
  let edgeRepo: jest.Mocked<Repository<GraphEdge>>;

  const mockNodeRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((data) => data),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
  };

  const mockEdgeRepo = {
    save: jest.fn(),
    create: jest.fn((data) => data),
  };

  const mockGeocodingService = {
    geocode: jest.fn().mockResolvedValue({ lat: 47.6, lng: -122.3, displayName: 'Seattle' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        { provide: getRepositoryToken(GraphNode), useValue: mockNodeRepo },
        { provide: getRepositoryToken(GraphEdge), useValue: mockEdgeRepo },
        { provide: GeocodingService, useValue: mockGeocodingService },
      ],
    }).compile();

    service = module.get<EnrichmentService>(EnrichmentService);
    nodeRepo = module.get(getRepositoryToken(GraphNode));
    edgeRepo = module.get(getRepositoryToken(GraphEdge));
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call enrichers for US jurisdiction', async () => {
    mockNodeRepo.findOne.mockResolvedValue(null);
    mockNodeRepo.save.mockImplementation((data) => Promise.resolve({ ...data, id: 'test-id' }));

    const result = await service.enrichCompany(
      'test-inv-id', 'root-node-id', 'TestCorp', 'test-123', 'us',
    );

    expect(result).toBeDefined();
    expect(result.locationsAdded).toBeGreaterThanOrEqual(0);
    expect(result.peopleAdded).toBeGreaterThanOrEqual(0);
    expect(result.subsidiariesAdded).toBeGreaterThanOrEqual(0);
  });
});
