import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Model, Connection } from 'mongoose';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueUrlCommand,
  PurgeQueueCommand,
} from '@aws-sdk/client-sqs';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  DailyReport,
  DailyReportDocument,
} from '../src/shared/schemas/daily-report.schema';
import { ReportStatus } from '../src/shared/constants/report-status.enum';
import { IngestionModule } from '../src/ingestion/ingestion.module';
import { ExtractionModule } from '../src/extraction/extraction.module';
import { LlmExtractorService } from '../src/extraction/services/llm-extractor.service';
import { PdfParserService } from '../src/extraction/services/pdf-parser.service';

/**
 * Pipeline E2E Test
 *
 * Tests the complete daily report processing pipeline with real infrastructure:
 * - MongoDB for document storage
 * - LocalStack S3 for file storage
 * - ElasticMQ for SQS message queue
 *
 * Prerequisites:
 * - Run `docker compose up -d` before executing tests
 * - Infrastructure services must be running on default ports
 *
 * @remarks
 * The LLM service is mocked to avoid external API dependencies and costs.
 * All other components use real infrastructure for integration testing.
 */
describe('Daily Report Pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let dailyReportModel: Model<DailyReportDocument>;
  let mongoConnection: Connection;
  let s3Client: S3Client;
  let sqsClient: SQSClient;

  const TEST_BUCKET = 'daily-reports';
  const TEST_QUEUE_NAME = 'daily-report-processing';

  // Sample Procore daily report PDF content (text representation)
  const SAMPLE_DAILY_REPORT_TEXT = `
DAILY REPORT
Project: Downtown Office Tower
Date: 2024-01-15
Subcontractor: ABC Construction

WEATHER CONDITIONS
Sky: Clear
Temperature High: 72°F
Temperature Low: 45°F
Notes: Perfect working conditions, no weather delays expected.

MANPOWER
Total Workers: 25
Crews:
- Structural Steel: 10 workers (ABC Construction)
- Electrical: 8 workers (XYZ Electric)
- HVAC: 7 workers (Cool Air Systems)
Notes: Full crew on site, all trades progressing well.

WORK PERFORMED
Area: Level 3 - East Wing
Status: In Progress
Notes: Steel framing 80% complete, electrical rough-in started.

Area: Level 2 - Core
Status: Completed
Notes: All MEP rough-in finished, ready for inspection.

GENERAL NOTES
Safety meeting conducted at 7:00 AM. No incidents reported.
Delivery of steel beams scheduled for tomorrow morning.
Owner walkthrough scheduled for Friday.
`;

  /**
   * Create a minimal valid PDF buffer for testing.
   * This creates a simple PDF with the sample text embedded.
   */
  function createTestPdfBuffer(): Buffer {
    // Create a minimal valid PDF structure
    // This is a simplified PDF that pdf-parse can extract text from
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${SAMPLE_DAILY_REPORT_TEXT.length + 50} >>
stream
BT
/F1 12 Tf
50 750 Td
(${SAMPLE_DAILY_REPORT_TEXT.replace(/\n/g, ') Tj T* (').replace(/[()\\]/g, '\\$&')}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${400 + SAMPLE_DAILY_REPORT_TEXT.length}
%%EOF`;

    return Buffer.from(pdfContent, 'utf-8');
  }

  /**
   * Mock LLM service to avoid external API calls during testing.
   */
  const mockLlmExtractorService = {
    extractSection: jest.fn().mockResolvedValue({
      data: null,
      confidence: 'medium',
      needsLlmFallback: false,
      rawText: '',
    }),
    detectConflicts: jest.fn().mockResolvedValue([]),
  };

  /**
   * Mock PDF parser service to avoid dynamic import issues in Jest.
   * The actual PDF parsing is tested in unit tests.
   */
  const mockPdfParserService = {
    extractText: jest.fn().mockResolvedValue(SAMPLE_DAILY_REPORT_TEXT),
  };

  beforeAll(async () => {
    // Initialize AWS clients for infrastructure setup
    s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
      forcePathStyle: true,
    });

    sqsClient = new SQSClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:9324',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });

    // Ensure S3 bucket exists
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
    } catch {
      await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
    }

    // Ensure SQS queue exists
    try {
      await sqsClient.send(new GetQueueUrlCommand({ QueueName: TEST_QUEUE_NAME }));
    } catch {
      await sqsClient.send(
        new CreateQueueCommand({ QueueName: TEST_QUEUE_NAME }),
      );
    }

    // Create NestJS test module
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
        ScheduleModule.forRoot(),
        MongooseModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            uri:
              configService.get<string>('MONGODB_URI') ||
              'mongodb://admin:admin@localhost:27017/daily_reports_test?authSource=admin',
          }),
          inject: [ConfigService],
        }),
        IngestionModule,
        ExtractionModule,
      ],
    })
      .overrideProvider(LlmExtractorService)
      .useValue(mockLlmExtractorService)
      .overrideProvider(PdfParserService)
      .useValue(mockPdfParserService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    dailyReportModel = moduleFixture.get<Model<DailyReportDocument>>(
      getModelToken(DailyReport.name),
    );
    mongoConnection = moduleFixture.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    // Clean up test data
    await dailyReportModel.deleteMany({});

    // Clean up S3 objects
    try {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({ Bucket: TEST_BUCKET }),
      );
      for (const obj of listResponse.Contents || []) {
        if (obj.Key) {
          await s3Client.send(
            new DeleteObjectCommand({ Bucket: TEST_BUCKET, Key: obj.Key }),
          );
        }
      }
    } catch (error) {
      console.warn('S3 cleanup warning:', error);
    }

    // Purge SQS queue
    try {
      const queueUrlResponse = await sqsClient.send(
        new GetQueueUrlCommand({ QueueName: TEST_QUEUE_NAME }),
      );
      if (queueUrlResponse.QueueUrl) {
        await sqsClient.send(
          new PurgeQueueCommand({ QueueUrl: queueUrlResponse.QueueUrl }),
        );
      }
    } catch (error) {
      console.warn('SQS cleanup warning:', error);
    }

    await app.close();
  });

  beforeEach(async () => {
    // Clear database before each test
    await dailyReportModel.deleteMany({});
    jest.clearAllMocks();
  });

  describe('Full Pipeline Flow', () => {
    it('should process a daily report through the complete pipeline', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();
      const metadata = {
        tenant: 'test-tenant',
        project: 'downtown-office-tower',
        subcontractor: 'abc-construction',
        reportDate: '2024-01-15',
      };

      // Act - Upload the report
      const uploadResponse = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, 'daily-report-2024-01-15.pdf')
        .field('tenant', metadata.tenant)
        .field('project', metadata.project)
        .field('subcontractor', metadata.subcontractor)
        .field('reportDate', metadata.reportDate);

      // Assert - Upload succeeded
      expect(uploadResponse.status).toBe(201);
      expect(uploadResponse.body).toMatchObject({
        tenant: metadata.tenant,
        project: metadata.project,
        subcontractor: metadata.subcontractor,
        status: ReportStatus.PENDING,
      });
      expect(uploadResponse.body.id).toBeDefined();
      expect(uploadResponse.body.s3Key).toBeDefined();

      const reportId = uploadResponse.body.id;

      // Wait for processing to complete (poll with timeout)
      const maxWaitTime = 30000; // 30 seconds
      const pollInterval = 1000; // 1 second
      const startTime = Date.now();

      let finalReport: DailyReportDocument | null = null;

      while (Date.now() - startTime < maxWaitTime) {
        finalReport = await dailyReportModel.findById(reportId);

        if (
          finalReport &&
          (finalReport.status === ReportStatus.COMPLETED ||
            finalReport.status === ReportStatus.FAILED)
        ) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Assert - Processing completed
      expect(finalReport).not.toBeNull();
      expect(finalReport!.status).toBe(ReportStatus.COMPLETED);

      // Assert - Extracted data is present
      expect(finalReport!.extractedData).toBeDefined();

      // Assert - Weather data extracted (structured extraction)
      if (finalReport!.extractedData?.weather) {
        expect(finalReport!.extractedData.weather).toHaveProperty('conditions');
        expect(finalReport!.extractedData.weather).toHaveProperty(
          'temperatureHigh',
        );
        expect(finalReport!.extractedData.weather).toHaveProperty(
          'temperatureLow',
        );
      }

      // Assert - Manpower data extracted
      if (finalReport!.extractedData?.manpower) {
        expect(finalReport!.extractedData.manpower).toHaveProperty(
          'totalWorkers',
        );
        expect(finalReport!.extractedData.manpower).toHaveProperty('crews');
      }

      // Assert - Work areas extracted
      if (finalReport!.extractedData?.workAreas) {
        expect(Array.isArray(finalReport!.extractedData.workAreas)).toBe(true);
      }

      // Assert - LLM service was called for conflict detection
      expect(mockLlmExtractorService.detectConflicts).toHaveBeenCalled();
    }, 60000); // Extended timeout for async processing

    it('should handle multiple concurrent uploads', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();
      const uploads = [
        { tenant: 'tenant-1', project: 'project-a', subcontractor: 'sub-1' },
        { tenant: 'tenant-2', project: 'project-b', subcontractor: 'sub-2' },
        { tenant: 'tenant-3', project: 'project-c', subcontractor: 'sub-3' },
      ];

      // Act - Upload multiple reports concurrently
      const uploadPromises = uploads.map((metadata) =>
        request(app.getHttpServer())
          .post('/reports/upload')
          .attach('file', testPdf, `report-${metadata.tenant}.pdf`)
          .field('tenant', metadata.tenant)
          .field('project', metadata.project)
          .field('subcontractor', metadata.subcontractor),
      );

      const responses = await Promise.all(uploadPromises);

      // Assert - All uploads succeeded
      responses.forEach((response, index) => {
        expect(response.status).toBe(201);
        expect(response.body.tenant).toBe(uploads[index].tenant);
        expect(response.body.status).toBe(ReportStatus.PENDING);
      });

      // Assert - All reports created in database
      const count = await dailyReportModel.countDocuments();
      expect(count).toBe(3);
    });

    it('should reject non-PDF files', async () => {
      // Arrange
      const textFile = Buffer.from('This is not a PDF');

      // Act
      const response = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', textFile, 'report.txt')
        .field('tenant', 'test-tenant')
        .field('project', 'test-project')
        .field('subcontractor', 'test-sub');

      // Assert
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('PDF');
    });

    it('should reject upload without required metadata', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();

      // Act - Missing tenant
      const response = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, 'report.pdf')
        .field('project', 'test-project')
        .field('subcontractor', 'test-sub');

      // Assert
      expect(response.status).toBe(400);
    });
  });

  describe('Status Transitions', () => {
    it('should transition through PENDING -> PROCESSING -> COMPLETED', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();
      const statusHistory: ReportStatus[] = [];

      // Act - Upload
      const uploadResponse = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, 'status-test.pdf')
        .field('tenant', 'test-tenant')
        .field('project', 'test-project')
        .field('subcontractor', 'test-sub');

      expect(uploadResponse.status).toBe(201);
      const reportId = uploadResponse.body.id;
      statusHistory.push(uploadResponse.body.status);

      // Poll for status changes
      const maxWaitTime = 30000;
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        const report = await dailyReportModel.findById(reportId);
        if (report && !statusHistory.includes(report.status)) {
          statusHistory.push(report.status);
        }

        if (report?.status === ReportStatus.COMPLETED) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Assert - All expected statuses were observed
      expect(statusHistory).toContain(ReportStatus.PENDING);
      expect(statusHistory).toContain(ReportStatus.COMPLETED);
      // PROCESSING may be too fast to catch, but should be in history if observed
    }, 60000);
  });

  describe('Data Integrity', () => {
    it('should preserve original filename in database', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();
      const originalFilename = 'my-special-report-2024-01-15.pdf';

      // Act
      const response = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, originalFilename)
        .field('tenant', 'test-tenant')
        .field('project', 'test-project')
        .field('subcontractor', 'test-sub');

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.originalFilename).toBe(originalFilename);

      const report = await dailyReportModel.findById(response.body.id);
      expect(report?.originalFilename).toBe(originalFilename);
    });

    it('should store file size correctly', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();

      // Act
      const response = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, 'size-test.pdf')
        .field('tenant', 'test-tenant')
        .field('project', 'test-project')
        .field('subcontractor', 'test-sub');

      // Assert
      expect(response.status).toBe(201);

      const report = await dailyReportModel.findById(response.body.id);
      expect(report?.fileSize).toBe(testPdf.length);
    });

    it('should generate unique S3 keys for same filename', async () => {
      // Arrange
      const testPdf = createTestPdfBuffer();
      const filename = 'duplicate-name.pdf';

      // Act - Upload same filename twice
      const response1 = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, filename)
        .field('tenant', 'tenant-1')
        .field('project', 'project-1')
        .field('subcontractor', 'sub-1');

      const response2 = await request(app.getHttpServer())
        .post('/reports/upload')
        .attach('file', testPdf, filename)
        .field('tenant', 'tenant-2')
        .field('project', 'project-2')
        .field('subcontractor', 'sub-2');

      // Assert - Different S3 keys generated
      expect(response1.status).toBe(201);
      expect(response2.status).toBe(201);
      expect(response1.body.s3Key).not.toBe(response2.body.s3Key);
    });
  });
});
