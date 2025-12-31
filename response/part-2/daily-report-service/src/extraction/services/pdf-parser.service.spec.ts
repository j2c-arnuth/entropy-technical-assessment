import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PdfParserService } from './pdf-parser.service';

// Mock pdf-parse
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: 'Extracted PDF text content' }),
  })),
}));

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  GetObjectCommand: jest.fn(),
}));

describe('PdfParserService', () => {
  let service: PdfParserService;
  let mockS3Send: jest.Mock;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        AWS_REGION: 'us-east-1',
        S3_ENDPOINT: 'http://localhost:4566',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        S3_BUCKET: 'daily-reports',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock for S3 send
    mockS3Send = jest.fn();

    // Mock S3Client constructor
    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.mockImplementation(() => ({
      send: mockS3Send,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfParserService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<PdfParserService>(PdfParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractText', () => {
    it('should download PDF from S3 and extract text', async () => {
      // Mock S3 response with async iterable body
      const mockBuffer = Buffer.from('mock pdf content');
      const mockBody = {
        async *[Symbol.asyncIterator]() {
          yield mockBuffer;
        },
      };
      mockS3Send.mockResolvedValue({ Body: mockBody });

      const result = await service.extractText('2025-01-01/uuid/test.pdf');

      expect(result).toBe('Extracted PDF text content');
      expect(mockS3Send).toHaveBeenCalled();
    });

    it('should throw error when S3 response body is empty', async () => {
      mockS3Send.mockResolvedValue({ Body: null });

      await expect(
        service.extractText('2025-01-01/uuid/test.pdf'),
      ).rejects.toThrow('S3 download failed');
    });

    it('should throw error when S3 download fails', async () => {
      mockS3Send.mockRejectedValue(new Error('Network error'));

      await expect(
        service.extractText('2025-01-01/uuid/test.pdf'),
      ).rejects.toThrow('S3 download failed');
    });
  });
});
