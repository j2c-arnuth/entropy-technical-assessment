import { Injectable } from '@nestjs/common';

/**
 * Service for publishing messages to SQS queue.
 *
 * @remarks
 * This is a stub implementation. Full SQS integration will be implemented
 * in the messaging module task.
 */
@Injectable()
export class MessagingService {
  /**
   * Publish a message to trigger report processing.
   *
   * @param reportId - The MongoDB ObjectId of the daily report
   * @param s3Key - The S3 key where the PDF is stored
   *
   * @remarks
   * TODO: Implement full SQS publishing with:
   * - SQS client initialization from ConfigService
   * - Message serialization
   * - Error handling and retries
   */
  async publishProcessingMessage(
    reportId: string,
    s3Key: string,
  ): Promise<void> {
    // Stub: Log message for now, will be replaced with actual SQS call
    console.log(
      `[MessagingService] Publishing processing message for report ${reportId}, s3Key: ${s3Key}`,
    );
  }
}
