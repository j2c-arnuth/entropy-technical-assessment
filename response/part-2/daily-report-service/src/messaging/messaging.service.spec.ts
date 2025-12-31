import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MessagingService } from './messaging.service';

// Mock AWS SDK
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendMessageCommand: jest.fn().mockImplementation((params) => ({
    ...params,
    _type: 'SendMessageCommand',
  })),
  GetQueueAttributesCommand: jest.fn().mockImplementation((params) => ({
    ...params,
    _type: 'GetQueueAttributesCommand',
  })),
}));

describe('MessagingService', () => {
  let service: MessagingService;

  const mockQueueUrl =
    'http://localhost:9324/000000000000/daily-report-processing';

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        AWS_REGION: 'us-east-1',
        SQS_ENDPOINT: 'http://localhost:9324',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        SQS_QUEUE_URL: mockQueueUrl,
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Default: queue validation succeeds
    mockSend.mockResolvedValue({ Attributes: { QueueArn: 'arn:aws:sqs:...' } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);

    // Manually trigger onModuleInit since TestingModule doesn't call lifecycle hooks
    await service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should validate queue on initialization', async () => {
      // onModuleInit was already called in beforeEach
      // Verify GetQueueAttributesCommand was sent
      expect(mockSend).toHaveBeenCalled();
      const calls = mockSend.mock.calls;
      const initCall = calls.find(
        (call) => call[0]._type === 'GetQueueAttributesCommand',
      );
      expect(initCall).toBeDefined();
      expect(initCall[0].QueueUrl).toBe(mockQueueUrl);
    });

    it('should throw error if queue validation fails', async () => {
      // Create a new module with failing queue validation
      mockSend.mockRejectedValueOnce(new Error('Queue not found'));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MessagingService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const failingService = module.get<MessagingService>(MessagingService);

      await expect(failingService.onModuleInit()).rejects.toThrow(
        'SQS queue not accessible',
      );
    });
  });

  describe('publishProcessingMessage', () => {
    const reportId = 'report-123';
    const s3Key = '2025-01-01/uuid/test.pdf';
    const tenant = 'tenant-1';
    const project = 'project-1';
    const subcontractor = 'subcontractor-1';

    beforeEach(() => {
      // Reset and set up mock for successful message send
      mockSend.mockResolvedValue({ MessageId: 'msg-123' });
    });

    it('should publish message with correct payload structure', async () => {
      await service.publishProcessingMessage(
        reportId,
        s3Key,
        tenant,
        project,
        subcontractor,
      );

      // Find the SendMessageCommand call
      const sendCalls = mockSend.mock.calls.filter(
        (call) => call[0]._type === 'SendMessageCommand',
      );
      expect(sendCalls.length).toBe(1);

      const command = sendCalls[0][0];
      expect(command.QueueUrl).toBe(mockQueueUrl);

      const messageBody = JSON.parse(command.MessageBody);
      expect(messageBody.reportId).toBe(reportId);
      expect(messageBody.s3Key).toBe(s3Key);
      expect(messageBody.tenant).toBe(tenant);
      expect(messageBody.project).toBe(project);
      expect(messageBody.subcontractor).toBe(subcontractor);
      expect(messageBody.publishedAt).toBeDefined();
    });

    it('should not include message attributes (routing is control-plane concern)', async () => {
      await service.publishProcessingMessage(
        reportId,
        s3Key,
        tenant,
        project,
        subcontractor,
      );

      const sendCalls = mockSend.mock.calls.filter(
        (call) => call[0]._type === 'SendMessageCommand',
      );
      const command = sendCalls[0][0];

      expect(command.MessageAttributes).toBeUndefined();
    });

    it('should include ISO timestamp in message', async () => {
      const beforeTime = new Date().toISOString();

      await service.publishProcessingMessage(
        reportId,
        s3Key,
        tenant,
        project,
        subcontractor,
      );

      const afterTime = new Date().toISOString();

      const sendCalls = mockSend.mock.calls.filter(
        (call) => call[0]._type === 'SendMessageCommand',
      );
      const messageBody = JSON.parse(sendCalls[0][0].MessageBody);

      // Timestamp should be between before and after
      expect(messageBody.publishedAt >= beforeTime).toBe(true);
      expect(messageBody.publishedAt <= afterTime).toBe(true);
    });

    it('should throw error if message publishing fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('SQS connection failed'));

      await expect(
        service.publishProcessingMessage(
          reportId,
          s3Key,
          tenant,
          project,
          subcontractor,
        ),
      ).rejects.toThrow('Failed to publish SQS message');
    });
  });
});
