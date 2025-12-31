import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3StorageService } from './s3-storage.service';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn().mockImplementation((params) => params),
}));

describe('S3StorageService', () => {
  let service: S3StorageService;

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<S3StorageService>(S3StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateKey', () => {
    it('should generate a key with date/uuid/filename pattern', () => {
      const filename = 'test-report.pdf';
      const key = service.generateKey(filename);

      // Should match pattern: YYYY-MM-DD/uuid/filename
      const parts = key.split('/');
      expect(parts).toHaveLength(3);

      // First part should be a valid date
      expect(parts[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Second part should be a UUID
      expect(parts[1]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Third part should be the original filename
      expect(parts[2]).toBe(filename);
    });

    it('should generate unique keys for the same filename', () => {
      const filename = 'test-report.pdf';
      const key1 = service.generateKey(filename);
      const key2 = service.generateKey(filename);

      expect(key1).not.toBe(key2);
    });
  });

  describe('uploadFile', () => {
    it('should upload a file and return the key', async () => {
      const buffer = Buffer.from('test content');
      const key = '2025-01-01/uuid/test.pdf';
      const contentType = 'application/pdf';

      const result = await service.uploadFile(buffer, key, contentType);

      expect(result).toBe(key);
    });
  });
});
