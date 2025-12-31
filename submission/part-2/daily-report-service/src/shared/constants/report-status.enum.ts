/**
 * Processing status for daily reports.
 *
 * Represents the lifecycle of a report from upload through extraction.
 */
export enum ReportStatus {
  /** Report uploaded, awaiting processing */
  PENDING = 'pending',

  /** Extraction in progress */
  PROCESSING = 'processing',

  /** Extraction completed successfully */
  COMPLETED = 'completed',

  /** Extraction failed */
  FAILED = 'failed',
}
