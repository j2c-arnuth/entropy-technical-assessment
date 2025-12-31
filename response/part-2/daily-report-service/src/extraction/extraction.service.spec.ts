import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { ExtractionService } from './extraction.service';
import { PdfParserService } from './services/pdf-parser.service';
import { StructuredExtractorService } from './services/structured-extractor.service';
import { LlmExtractorService } from './services/llm-extractor.service';
import { DailyReport } from '../shared/schemas/daily-report.schema';
import { ReportStatus } from '../shared/constants/report-status.enum';
import { ExtractionConfidence } from './interfaces/extraction-result.interface';

// Mock AWS SDK
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  ReceiveMessageCommand: jest.fn(),
  DeleteMessageCommand: jest.fn(),
}));

describe('ExtractionService', () => {
  let service: ExtractionService;
  let mockSqsSend: jest.Mock;
  let mockDailyReportModel: any;
  let mockPdfParserService: any;
  let mockStructuredExtractorService: any;
  let mockLlmExtractorService: any;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        AWS_REGION: 'us-east-1',
        SQS_ENDPOINT: 'http://localhost:9324',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        SQS_QUEUE_URL: 'http://localhost:9324/000000000000/test-queue',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create mock for SQS send
    mockSqsSend = jest.fn();

    // Mock SQSClient constructor
    const { SQSClient } = require('@aws-sdk/client-sqs');
    SQSClient.mockImplementation(() => ({
      send: mockSqsSend,
    }));

    // Mock DailyReport model
    mockDailyReportModel = {
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };

    // Mock services
    mockPdfParserService = {
      extractText: jest.fn().mockResolvedValue('Weather:\nHigh: 75°F\nLow: 55°F'),
    };

    mockStructuredExtractorService = {
      extract: jest.fn().mockReturnValue({
        weather: {
          data: { conditions: 'Clear', temperatureHigh: 75, temperatureLow: 55, notes: '' },
          confidence: ExtractionConfidence.HIGH,
          needsLlmFallback: false,
          rawText: 'Weather section text',
        },
        manpower: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: false,
          rawText: undefined,
        },
        workAreas: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: false,
          rawText: undefined,
        },
        notes: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: false,
          rawText: undefined,
        },
      }),
    };

    mockLlmExtractorService = {
      extractSection: jest.fn().mockResolvedValue({
        data: null,
        confidence: ExtractionConfidence.MEDIUM,
        needsLlmFallback: false,
      }),
      detectConflicts: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtractionService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getModelToken(DailyReport.name),
          useValue: mockDailyReportModel,
        },
        {
          provide: PdfParserService,
          useValue: mockPdfParserService,
        },
        {
          provide: StructuredExtractorService,
          useValue: mockStructuredExtractorService,
        },
        {
          provide: LlmExtractorService,
          useValue: mockLlmExtractorService,
        },
      ],
    }).compile();

    service = module.get<ExtractionService>(ExtractionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('pollQueue', () => {
    it('should process message from queue', async () => {
      const mockMessage = {
        Body: JSON.stringify({
          reportId: 'report-123',
          s3Key: '2025-01-01/uuid/test.pdf',
          tenant: 'tenant-1',
          project: 'project-1',
          subcontractor: 'sub-1',
          publishedAt: new Date().toISOString(),
        }),
        ReceiptHandle: 'receipt-handle-123',
      };

      mockSqsSend
        .mockResolvedValueOnce({ Messages: [mockMessage] }) // ReceiveMessage
        .mockResolvedValueOnce({}); // DeleteMessage

      await service.pollQueue();

      // Verify status was updated to PROCESSING
      expect(mockDailyReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'report-123',
        { status: ReportStatus.PROCESSING },
      );

      // Verify PDF was parsed
      expect(mockPdfParserService.extractText).toHaveBeenCalledWith(
        '2025-01-01/uuid/test.pdf',
      );

      // Verify structured extraction was run
      expect(mockStructuredExtractorService.extract).toHaveBeenCalled();

      // Verify conflict detection was run
      expect(mockLlmExtractorService.detectConflicts).toHaveBeenCalled();

      // Verify status was updated to COMPLETED
      expect(mockDailyReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'report-123',
        expect.objectContaining({
          status: ReportStatus.COMPLETED,
          extractedData: expect.any(Object),
        }),
      );

      // Verify message was deleted
      expect(mockSqsSend).toHaveBeenCalledTimes(2);
    });

    it('should handle empty queue', async () => {
      mockSqsSend.mockResolvedValue({ Messages: [] });

      await service.pollQueue();

      expect(mockPdfParserService.extractText).not.toHaveBeenCalled();
    });

    it('should update status to FAILED on error', async () => {
      const mockMessage = {
        Body: JSON.stringify({
          reportId: 'report-456',
          s3Key: '2025-01-01/uuid/test.pdf',
          tenant: 'tenant-1',
          project: 'project-1',
          subcontractor: 'sub-1',
          publishedAt: new Date().toISOString(),
        }),
        ReceiptHandle: 'receipt-handle-456',
      };

      mockSqsSend.mockResolvedValue({ Messages: [mockMessage] });
      mockPdfParserService.extractText.mockRejectedValue(
        new Error('S3 download failed'),
      );

      await service.pollQueue();

      // Verify status was updated to FAILED
      expect(mockDailyReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'report-456',
        { status: ReportStatus.FAILED },
      );
    });

    it('should invoke LLM fallback for ambiguous sections', async () => {
      mockStructuredExtractorService.extract.mockReturnValue({
        weather: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: true,
          rawText: 'Ambiguous weather text',
        },
        manpower: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: false,
          rawText: undefined,
        },
        workAreas: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: false,
          rawText: undefined,
        },
        notes: {
          data: null,
          confidence: ExtractionConfidence.LOW,
          needsLlmFallback: false,
          rawText: undefined,
        },
      });

      const mockMessage = {
        Body: JSON.stringify({
          reportId: 'report-789',
          s3Key: '2025-01-01/uuid/test.pdf',
          tenant: 'tenant-1',
          project: 'project-1',
          subcontractor: 'sub-1',
          publishedAt: new Date().toISOString(),
        }),
        ReceiptHandle: 'receipt-handle-789',
      };

      mockSqsSend
        .mockResolvedValueOnce({ Messages: [mockMessage] })
        .mockResolvedValueOnce({});

      await service.pollQueue();

      expect(mockLlmExtractorService.extractSection).toHaveBeenCalledWith(
        'weather',
        'Ambiguous weather text',
      );
    });

    it('should not process when already processing', async () => {
      const mockMessage = {
        Body: JSON.stringify({
          reportId: 'report-123',
          s3Key: '2025-01-01/uuid/test.pdf',
          tenant: 'tenant-1',
          project: 'project-1',
          subcontractor: 'sub-1',
          publishedAt: new Date().toISOString(),
        }),
        ReceiptHandle: 'receipt-handle-123',
      };

      let resolveFirst: (value: any) => void;
      const firstCallPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      // Make the first call block until we resolve it
      mockSqsSend.mockImplementationOnce(() => firstCallPromise);

      // Start first poll (this sets isProcessing = true)
      const poll1 = service.pollQueue();

      // Small delay to ensure first poll has started
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to start second poll - should exit early due to isProcessing flag
      await service.pollQueue();

      // Now resolve the first call
      resolveFirst!({ Messages: [mockMessage] });

      // Set up mock for delete message
      mockSqsSend.mockResolvedValueOnce({});

      await poll1;

      // First poll should have called receive + delete (2 calls)
      // Second poll should have returned early (0 additional calls)
      expect(mockSqsSend).toHaveBeenCalledTimes(2);
    });
  });
});
