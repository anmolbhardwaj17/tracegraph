import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AddressVerificationService } from './address-verification.service';
import { GraphNode } from '../graph/entities/graph-node.entity';

describe('AddressVerificationService', () => {
  let service: AddressVerificationService;

  const mockNodeRepo = {
    find: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressVerificationService,
        { provide: getRepositoryToken(GraphNode), useValue: mockNodeRepo },
      ],
    }).compile();

    service = module.get<AddressVerificationService>(AddressVerificationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should detect virtual office addresses', async () => {
    mockNodeRepo.find.mockImplementation(({ where }: any) => {
      if (where.entityType === 'address') {
        return Promise.resolve([
          { id: '1', entityType: 'address', entityId: 'a-1', metadata: { raw: { address: '71-75 Shelton Street, Covent Garden, WeWork London' } } },
        ]);
      }
      return Promise.resolve([]);
    });
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.verify('test-inv-id');

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    const wework = result.results.find((r) => r.flags.includes('VIRTUAL_OFFICE'));
    expect(wework).toBeDefined();
  });

  it('should detect formation agent addresses', async () => {
    mockNodeRepo.find.mockImplementation(({ where }: any) => {
      if (where.entityType === 'address') {
        return Promise.resolve([
          { id: '1', entityType: 'address', entityId: 'a-1', metadata: { raw: { address: '1209 Orange St, Wilmington, Delaware' } } },
        ]);
      }
      return Promise.resolve([]);
    });
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.verify('test-inv-id');

    const delaware = result.results.find((r) => r.flags.includes('FORMATION_AGENT_ADDRESS'));
    expect(delaware).toBeDefined();
  });

  it('should detect PO boxes', async () => {
    mockNodeRepo.find.mockImplementation(({ where }: any) => {
      if (where.entityType === 'address') {
        return Promise.resolve([
          { id: '1', entityType: 'address', entityId: 'a-1', metadata: { raw: { address: 'P.O. Box 1234, Miami, FL' } } },
        ]);
      }
      return Promise.resolve([]);
    });
    mockNodeRepo.update.mockResolvedValue(undefined);

    const result = await service.verify('test-inv-id');

    const pobox = result.results.find((r) => r.flags.includes('PO_BOX'));
    expect(pobox).toBeDefined();
  });

  it('should handle no addresses', async () => {
    mockNodeRepo.find.mockResolvedValue([]);
    const result = await service.verify('test-inv-id');
    expect(result.results.length).toBe(0);
    expect(result.findings.length).toBe(0);
  });
});
