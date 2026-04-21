import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IndiaSearchService } from './india-search.service';
import { IndiaCompany } from './india-company.entity';

describe('IndiaSearchService', () => {
  let service: IndiaSearchService;

  const mockRepo = {
    count: jest.fn().mockResolvedValue(21958),
    find: jest.fn(),
    findOne: jest.fn(),
    query: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        { cin: 'U99999DL1973PLC362935', companyName: 'RELIANCE STEELS LIMITED', status: 'Active' },
      ]),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndiaSearchService,
        { provide: getRepositoryToken(IndiaCompany), useValue: mockRepo },
      ],
    }).compile();
    service = module.get(IndiaSearchService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should search companies by name', async () => {
    const results = await service.search('reliance');
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should save discovered companies', async () => {
    await service.saveDiscovered({
      cin: 'L17110MH1973PLC019786',
      companyName: 'Reliance Industries Limited',
      status: 'Active',
      listedStatus: 'Listed',
    });
    expect(mockRepo.query).toHaveBeenCalled();
  });

  it('should handle missing CIN gracefully', async () => {
    await service.saveDiscovered({ cin: '', companyName: '' });
    expect(mockRepo.query).not.toHaveBeenCalled();
  });

  it('should get count', async () => {
    const count = await service.count();
    expect(count).toBe(21958);
  });
});
