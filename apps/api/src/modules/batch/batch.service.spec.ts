import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BatchService } from './batch.service';
import { BatchScreen } from './entities/batch-screen.entity';
import { Investigation } from '../investigation/entities/investigation.entity';
import { InvestigationService } from '../investigation/investigation.service';

describe('BatchService', () => {
  let service: BatchService;

  const mockBatchRepo = {
    save: jest.fn((data) => Promise.resolve({ ...data, id: 'batch-1', createdAt: new Date() })),
    create: jest.fn((data) => data),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };

  const mockInvRepo = {
    findOne: jest.fn(),
  };

  const mockInvService = {
    create: jest.fn().mockResolvedValue({ id: 'inv-1', status: 'QUEUED' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchService,
        { provide: getRepositoryToken(BatchScreen), useValue: mockBatchRepo },
        { provide: getRepositoryToken(Investigation), useValue: mockInvRepo },
        { provide: InvestigationService, useValue: mockInvService },
      ],
    }).compile();
    service = module.get(BatchService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create batch with multiple companies', async () => {
    const result = await service.create([
      { name: 'Apple' },
      { name: 'Microsoft' },
      { name: 'Tesla' },
    ], { tier: 'QUICK', jurisdiction: 'us' });

    expect(result).toBeDefined();
    expect(mockInvService.create).toHaveBeenCalledTimes(3);
    expect(mockBatchRepo.save).toHaveBeenCalled();
  });

  it('should list batches', async () => {
    const result = await service.list();
    expect(Array.isArray(result)).toBe(true);
  });
});
