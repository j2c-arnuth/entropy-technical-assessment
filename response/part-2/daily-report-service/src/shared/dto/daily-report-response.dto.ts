import { ReportStatus } from '../constants/report-status.enum';

/**
 * Weather data in API responses.
 */
export class WeatherDataDto {
  conditions: string;
  temperatureHigh: number;
  temperatureLow: number;
  notes: string;
}

/**
 * Crew entry in API responses.
 */
export class CrewDto {
  trade: string;
  count: number;
  subcontractor: string;
}

/**
 * Manpower data in API responses.
 */
export class ManpowerDataDto {
  totalWorkers: number;
  crews: CrewDto[];
  notes: string;
}

/**
 * Work area entry in API responses.
 */
export class WorkAreaDto {
  name: string;
  status: string;
  notes: string;
}

/**
 * Extracted data in API responses.
 */
export class ExtractedDataDto {
  weather?: WeatherDataDto;
  manpower?: ManpowerDataDto;
  workAreas?: WorkAreaDto[];
  notes?: string;
}

/**
 * Daily report response DTO.
 *
 * Represents the shape of daily report data returned by the API.
 */
export class DailyReportResponseDto {
  /** Report ID */
  id: string;

  /** Tenant identifier */
  tenant: string;

  /** Project identifier */
  project: string;

  /** Subcontractor who submitted the report */
  subcontractor: string;

  /** Date the report covers */
  reportDate: Date;

  /** Current processing status */
  status: ReportStatus;

  /** S3 object key for the stored PDF */
  s3Key: string;

  /** Original filename of the uploaded PDF */
  originalFilename: string;

  /** Extracted structured data (present when status is COMPLETED) */
  extractedData?: ExtractedDataDto;

  /** Record creation timestamp */
  createdAt: Date;

  /** Record last update timestamp */
  updatedAt: Date;
}
