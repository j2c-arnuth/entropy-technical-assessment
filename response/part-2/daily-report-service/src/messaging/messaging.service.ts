import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { ProcessingMessage } from './interfaces/processing-message.interface';

/**
 * Service for publishing messages to SQS queue.
 *
 * @remarks
 * **Design Decision: Queue Validation on Startup**
 *
 * Validates queue existence during module initialization.
 *
 * Justification:
 * - Fail-fast approach catches configuration errors early
 * - Prevents silent failures during runtime
 * - Provides clear error messages for debugging
 *
 * Production Consideration:
 * Add health check endpoint that includes queue connectivity status.
 *
 * **Design Decision: Rich Message Payload**
 *
 * Message includes reportId, s3Key, tenant, project, subcontractor, and timestamp.
 *
 * Justification:
 * - Consumer has all context needed without additional DB lookups
 * - Enables message filtering and routing by tenant/project
 * - Timestamp supports observability and debugging
 *
 * Production Consideration:
 * Consider message schema versioning for backward compatibility.
 *
 * **Design Decision: No Retry Logic in Service**
 *
 * Relies on SQS built-in retry and dead-letter queue configuration.
 *
 * Justification:
 * - SQS provides robust retry mechanisms
 * - Keeps service code simple
 * - DLQ handling separates concerns
 *
 * Production Consideration:
 * Configure DLQ and set up monitoring/alerting for failed messages.
 */
@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger(MessagingService.name);
  private sqsClient: SQSClient;
  private queueUrl: string;

  constructor(private configService: ConfigService) {
    this.sqsClient = new SQSClient({
      region: this.configService.get<string>('AWS_REGION'),
      endpoint: this.configService.get<string>('SQS_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });
    this.queueUrl =
      this.configService.get<string>('SQS_QUEUE_URL') ||
      'http://localhost:9324/000000000000/daily-report-processing';
  }

  /**
   * Validate queue exists on module initialization.
   *
   * @throws Error if queue is not accessible
   */
  async onModuleInit(): Promise<void> {
    await this.validateQueue();
  }

  /**
   * Validate that the configured SQS queue exists and is accessible.
   *
   * @throws Error if queue validation fails
   */
  private async validateQueue(): Promise<void> {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ['QueueArn'],
      });

      await this.sqsClient.send(command);
      this.logger.log(`Queue validated: ${this.queueUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Queue validation failed: ${message}`);
      throw new Error(
        `SQS queue not accessible at ${this.queueUrl}: ${message}`,
      );
    }
  }

  /**
   * Publish a message to trigger report processing.
   *
   * @param reportId - The MongoDB ObjectId of the daily report
   * @param s3Key - The S3 key where the PDF is stored
   * @param tenant - Tenant identifier
   * @param project - Project identifier
   * @param subcontractor - Subcontractor who submitted the report
   *
   * @throws Error if message publishing fails
   */
  async publishProcessingMessage(
    reportId: string,
    s3Key: string,
    tenant: string,
    project: string,
    subcontractor: string,
  ): Promise<void> {
    const message: ProcessingMessage = {
      reportId,
      s3Key,
      tenant,
      project,
      subcontractor,
      publishedAt: new Date().toISOString(),
    };

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message),
    });

    try {
      const result = await this.sqsClient.send(command);
      this.logger.log(
        `Published processing message for report ${reportId}, MessageId: ${result.MessageId}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to publish message for report ${reportId}: ${errorMessage}`,
      );
      throw new Error(`Failed to publish SQS message: ${errorMessage}`);
    }
  }
}
