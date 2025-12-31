import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ReportStatus } from '../constants/report-status.enum';

/**
 * Crew entry within manpower data.
 *
 * @remarks
 * The `trade` field is a free-form string rather than an enum because:
 * - Trade types vary by project and subcontractor naming conventions
 * - Enums would need to be exhaustive or require constant updates
 * - LLM extraction may return varied descriptions that don't match strict enums
 */
export class Crew {
  /** Trade type (e.g., "Drywall", "MEP", "Structural") - free-form string */
  trade: string;

  /** Number of workers in this crew */
  count: number;

  /** Subcontractor providing this crew */
  subcontractor: string;
}

/**
 * Weather conditions extracted from the daily report.
 *
 * @remarks
 * The `conditions` field is a free-form string rather than an enum because:
 * - LLM extraction may return varied descriptions ("Clear", "Partly Cloudy", "Light Rain")
 * - Strict enums would require normalization logic and risk validation failures
 * - For production, consider adding normalization utilities that map common variations
 *   to canonical values while preserving original text
 */
export class WeatherData {
  /** Weather conditions description - free-form string */
  conditions: string;

  /** High temperature for the day */
  temperatureHigh: number;

  /** Low temperature for the day */
  temperatureLow: number;

  /** Additional weather observations */
  notes: string;
}

/**
 * Manpower/workforce data extracted from the daily report.
 */
export class ManpowerData {
  /** Total worker count across all crews */
  totalWorkers: number;

  /** Individual crew entries */
  crews: Crew[];

  /** Additional manpower observations */
  notes: string;
}

/**
 * Work area status entry.
 *
 * @remarks
 * The `name` field is a free-form string rather than an enum because:
 * - Work area names are project-specific (e.g., "Upper Concourse", "Section 12A")
 * - Cannot be pre-defined as they vary by construction project
 */
export class WorkArea {
  /** Work area name - free-form string, project-specific */
  name: string;

  /** Current status of work in this area */
  status: string;

  /** Additional observations for this work area */
  notes: string;
}

/**
 * Extracted data from the daily report PDF.
 *
 * @remarks
 * This is embedded as a subdocument rather than a separate collection because:
 * - Extracted data is always accessed together with the parent report
 * - Simplifies queries and reduces join overhead
 * - Appropriate for the minimal viable implementation scope
 *
 * For production, consider separating if independent querying of extracted
 * data across reports is required.
 */
export class ExtractedData {
  /** Weather conditions for the day */
  weather?: WeatherData;

  /** Workforce/manpower information */
  manpower?: ManpowerData;

  /** Status of work areas */
  workAreas?: WorkArea[];

  /** General notes and observations */
  notes?: string;
}

export type DailyReportDocument = HydratedDocument<DailyReport>;

/**
 * Daily Report schema for Procore daily report documents.
 *
 * @remarks
 * This schema represents a minimal viable implementation for the technical
 * assessment. Production implementations would additionally include:
 * - Multi-tenant isolation and access control
 * - Evidence chain-of-custody with confidence scores
 * - Audit trails and soft deletes
 * - Discriminated event types for cross-report analysis
 */
@Schema({ timestamps: true })
export class DailyReport {
  /** Tenant identifier for multi-tenant support */
  @Prop({ required: true })
  tenant: string;

  /** Project identifier */
  @Prop({ required: true })
  project: string;

  /** Subcontractor who submitted the report */
  @Prop({ required: true })
  subcontractor: string;

  /** Date the report covers */
  @Prop({ required: true })
  reportDate: Date;

  /** S3 object key for the stored PDF file */
  @Prop({ required: true })
  s3Key: string;

  /** Original filename of the uploaded PDF */
  @Prop({ required: true })
  originalFilename: string;

  /** File size in bytes */
  @Prop({ required: true })
  fileSize: number;

  /** Current processing status */
  @Prop({ required: true, enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  /** Extracted structured data (populated after extraction) */
  @Prop({ type: Object })
  extractedData?: ExtractedData;
}

export const DailyReportSchema = SchemaFactory.createForClass(DailyReport);
