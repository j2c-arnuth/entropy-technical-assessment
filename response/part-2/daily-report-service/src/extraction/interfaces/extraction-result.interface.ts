import { ExtractedData } from '../../shared/schemas/daily-report.schema';

/**
 * Confidence level for extracted section data.
 */
export enum ExtractionConfidence {
  /** Pattern matched cleanly, high confidence */
  HIGH = 'high',
  /** Pattern matched with some uncertainty */
  MEDIUM = 'medium',
  /** Pattern did not match, LLM fallback used or section ambiguous */
  LOW = 'low',
}

/**
 * Result of extracting a single section from the PDF.
 */
export interface SectionExtractionResult<T> {
  /** The extracted data for this section */
  data: T | null;

  /** Confidence level of the extraction */
  confidence: ExtractionConfidence;

  /** Whether this section needs LLM fallback processing */
  needsLlmFallback: boolean;

  /** Raw text that was used for extraction (for debugging/LLM context) */
  rawText?: string;
}

/**
 * Result of structured extraction before LLM processing.
 */
export interface StructuredExtractionResult {
  /** Weather section extraction result */
  weather: SectionExtractionResult<ExtractedData['weather']>;

  /** Manpower section extraction result */
  manpower: SectionExtractionResult<ExtractedData['manpower']>;

  /** Work areas section extraction result */
  workAreas: SectionExtractionResult<ExtractedData['workAreas']>;

  /** Notes section extraction result */
  notes: SectionExtractionResult<string>;
}

/**
 * Validation warning from conflict detection.
 */
export interface ValidationWarning {
  /** Type of conflict detected */
  type:
    | 'manpower_total_mismatch'
    | 'weather_inconsistency'
    | 'work_area_conflict'
    | 'cross_section_conflict'
    | 'other';

  /** Human-readable description of the conflict */
  message: string;

  /** Sections involved in the conflict */
  sections: string[];

  /** Severity of the warning */
  severity: 'info' | 'warning' | 'error';
}

/**
 * Final extraction result after all processing.
 */
export interface ExtractionResult {
  /** The extracted structured data */
  data: ExtractedData;

  /** Validation warnings from conflict detection */
  warnings: ValidationWarning[];

  /** Sections that required LLM fallback */
  llmFallbackSections: string[];

  /** Overall confidence of the extraction */
  overallConfidence: ExtractionConfidence;

  /** Processing metadata */
  metadata: {
    /** Time taken for PDF parsing (ms) */
    pdfParseTime: number;

    /** Time taken for structured extraction (ms) */
    structuredExtractionTime: number;

    /** Time taken for LLM processing (ms), 0 if not used */
    llmProcessingTime: number;

    /** Time taken for conflict detection (ms) */
    conflictDetectionTime: number;

    /** Total processing time (ms) */
    totalTime: number;
  };
}
