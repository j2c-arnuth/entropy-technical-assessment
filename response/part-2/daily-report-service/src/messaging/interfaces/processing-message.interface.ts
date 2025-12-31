/**
 * Interface for the SQS processing message payload.
 *
 * @remarks
 * This message is published after a daily report is successfully uploaded
 * and stored. The extraction service consumes these messages to process
 * the PDF and extract structured data.
 */
export interface ProcessingMessage {
  /** MongoDB ObjectId of the daily report */
  reportId: string;

  /** S3 key where the PDF is stored */
  s3Key: string;

  /** Tenant identifier for multi-tenant isolation */
  tenant: string;

  /** Project identifier */
  project: string;

  /** Subcontractor who submitted the report */
  subcontractor: string;

  /** ISO timestamp when the message was published */
  publishedAt: string;
}
