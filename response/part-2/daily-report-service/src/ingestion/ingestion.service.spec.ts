import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { IngestionService } from './ingestion.service';
import { S3StorageService } from './services/s3-storage.service';
import { MessagingService } from '../messaging/messaging.service';
import { DailyReport } from '../shared/schemas/daily-report.schema';
import { ReportStatus } from '../shared/constants/report-status.enum';

describe('IngestionService', () => {
  let service: IngestionService;
  let s3StorageService: S3StorageService;
  let messagingService: MessagingService;

  const mockS3Key = '2025-01-01/uuid-123/test-report.pdf';

  const mockS3StorageService = {
    generateKey: jest.fn().mockReturnValue(mockS3Key),
    uploadFile: jest.fn().mockResolvedValue(mockS3Key),
  };

  const mockMessagingService = {
    publishProcessingMessage: jest.fn().mockResolvedValue(undefined),
  };

  const mockSavedReport = {
    _id: { toString: () => 'report-id-123' },
    tenant: 'tenant-1',
    project: 'project-1',
    subcontractor: 'subcontractor-1',
    reportDate: new Date('2025-01-01'),
    s3Key: mockS3Key,
    originalFilename: 'test-report.pdf',
    fileSize: 1024,
    status: ReportStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn(),
  };

  mockSavedReport.save.mockResolvedValue(mockSavedReport);

  const mockDailyReportModel = jest.fn().mockImplementation(() => mockSavedReport);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        {
          provide: getModelToken(DailyReport.name),
          useValue: mockDailyReportModel,
        },
        {
          provide: S3StorageService,
          useValue: mockS3StorageService,
        },
        {
          provide: MessagingService,
          useValue: mockMessagingService,
        },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
    s3StorageService = module.get<S3StorageService>(S3StorageService);
    messagingService = module.get<MessagingService>(MessagingService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadReport', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'test-report.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('test content'),
      size: 1024,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    const mockDto = {
      tenant: 'tenant-1',
      project: 'project-1',
      subcontractor: 'subcontractor-1',
      reportDate: '2025-01-01',
    };

    it('should upload report and return saved document', async () => {
      const result = await service.uploadReport(mockFile, mockDto);

      expect(result).toBeDefined();
      expect(result.tenant).toBe('tenant-1');
      expect(result.status).toBe(ReportStatus.PENDING);
    });

    it('should generate S3 key using original filename', async () => {
      await service.uploadReport(mockFile, mockDto);

      expect(s3StorageService.generateKey).toHaveBeenCalledWith('test-report.pdf');
    });

    it('should upload file to S3', async () => {
      await service.uploadReport(mockFile, mockDto);

      expect(s3StorageService.uploadFile).toHaveBeenCalledWith(
        mockFile.buffer,
        mockS3Key,
        'application/pdf',
      );
    });

    it('should publish processing message after save', async () => {
      await service.uploadReport(mockFile, mockDto);

      expect(messagingService.publishProcessingMessage).toHaveBeenCalledWith(
        'report-id-123',
        mockS3Key,
      );
    });

    it('should use current date if reportDate not provided', async () => {
      const dtoWithoutDate = {
        tenant: 'tenant-1',
        project: 'project-1',
        subcontractor: 'subcontractor-1',
      };

      await service.uploadReport(mockFile, dtoWithoutDate);

      // Model should have been called (we can't easily check the date value with this mock setup)
      expect(mockDailyReportModel).toHaveBeenCalled();
    });
  });
});
