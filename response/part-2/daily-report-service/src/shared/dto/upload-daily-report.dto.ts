import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * DTO for daily report upload requests.
 *
 * Used with multipart form data where the PDF file is uploaded
 * alongside these metadata fields.
 */
export class UploadDailyReportDto {
  /** Tenant identifier */
  @IsString()
  tenant: string;

  /** Project identifier */
  @IsString()
  project: string;

  /** Subcontractor who submitted the report */
  @IsString()
  subcontractor: string;

  /**
   * Date the report covers.
   * Optional - can be inferred from the PDF content if not provided.
   */
  @IsOptional()
  @IsDateString()
  reportDate?: string;
}
