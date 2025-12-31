import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ExtractedData,
  WeatherData,
  ManpowerData,
  WorkArea,
} from '../../shared/schemas/daily-report.schema';
import {
  ValidationWarning,
  ExtractionConfidence,
  SectionExtractionResult,
} from '../interfaces/extraction-result.interface';

/**
 * Service for LLM-based extraction fallback and conflict detection.
 *
 * @remarks
 * **Design Decision: Targeted LLM Usage**
 *
 * LLM is only invoked for:
 * 1. Sections flagged as ambiguous by structured extraction
 * 2. Conflict detection across all extracted data
 *
 * Justification:
 * - Minimizes API costs and latency
 * - Structured extraction handles most cases deterministically
 * - LLM adds value for ambiguous content and validation
 *
 * Production Consideration:
 * Consider caching LLM responses, implementing rate limiting, and
 * adding retry logic with exponential backoff.
 *
 * **Design Decision: JSON Mode for Extraction**
 *
 * Uses OpenAI's JSON mode for structured responses.
 *
 * Justification:
 * - Ensures parseable responses
 * - Reduces prompt complexity for output formatting
 * - Improves extraction reliability
 */
@Injectable()
export class LlmExtractorService {
  private readonly logger = new Logger(LlmExtractorService.name);
  private openai: OpenAI;
  private model: string;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('LLM_API_KEY'),
    });
    this.model = this.configService.get<string>('LLM_MODEL') || 'gpt-4';
  }

  /**
   * Extract data from ambiguous section text using LLM.
   *
   * @param sectionName - The name of the section to extract
   * @param rawText - The raw text content of the section
   * @returns Extracted data for the section
   */
  async extractSection<T>(
    sectionName: 'weather' | 'manpower' | 'workAreas' | 'notes',
    rawText: string,
  ): Promise<SectionExtractionResult<T>> {
    this.logger.log(`LLM fallback extraction for section: ${sectionName}`);

    const prompt = this.buildExtractionPrompt(sectionName, rawText);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a data extraction assistant. Extract structured data from construction daily report text. Return valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1, // Low temperature for consistent extraction
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      const parsed = JSON.parse(content);

      return {
        data: parsed.data as T,
        confidence: ExtractionConfidence.MEDIUM, // LLM extraction is medium confidence
        needsLlmFallback: false,
        rawText,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`LLM extraction failed for ${sectionName}: ${message}`);

      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: false, // Already tried LLM
        rawText,
      };
    }
  }

  /**
   * Detect conflicts and inconsistencies in extracted data.
   *
   * @param extractedData - The complete extracted data
   * @returns Array of validation warnings
   */
  async detectConflicts(extractedData: ExtractedData): Promise<ValidationWarning[]> {
    this.logger.log('Running LLM conflict detection');

    // First, check for obvious programmatic conflicts
    const programmaticWarnings = this.checkProgrammaticConflicts(extractedData);

    // Then, use LLM for semantic conflict detection
    const llmWarnings = await this.detectSemanticConflicts(extractedData);

    return [...programmaticWarnings, ...llmWarnings];
  }

  /**
   * Build extraction prompt for a specific section.
   */
  private buildExtractionPrompt(
    sectionName: 'weather' | 'manpower' | 'workAreas' | 'notes',
    rawText: string,
  ): string {
    const schemas: Record<string, string> = {
      weather: `{
  "data": {
    "conditions": "string - sky/weather conditions",
    "temperatureHigh": number,
    "temperatureLow": number,
    "notes": "string - additional observations"
  }
}`,
      manpower: `{
  "data": {
    "totalWorkers": number,
    "crews": [
      {"trade": "string", "count": number, "subcontractor": "string"}
    ],
    "notes": "string"
  }
}`,
      workAreas: `{
  "data": [
    {"name": "string", "status": "string", "notes": "string"}
  ]
}`,
      notes: `{
  "data": "string - the extracted notes content"
}`,
    };

    return `Extract ${sectionName} data from this daily report text:

---
${rawText}
---

Return JSON matching this schema:
${schemas[sectionName]}

If information is not present, use null for the data field.`;
  }

  /**
   * Check for programmatic conflicts (no LLM needed).
   */
  private checkProgrammaticConflicts(
    extractedData: ExtractedData,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    // Check manpower total vs crew sum
    if (extractedData.manpower) {
      const { totalWorkers, crews } = extractedData.manpower;
      const crewSum = crews?.reduce((sum, crew) => sum + crew.count, 0) || 0;

      if (totalWorkers > 0 && crewSum > 0 && totalWorkers !== crewSum) {
        warnings.push({
          type: 'manpower_total_mismatch',
          message: `Manpower total (${totalWorkers}) does not match sum of crews (${crewSum})`,
          sections: ['manpower'],
          severity: 'warning',
        });
      }
    }

    return warnings;
  }

  /**
   * Use LLM to detect semantic conflicts.
   */
  private async detectSemanticConflicts(
    extractedData: ExtractedData,
  ): Promise<ValidationWarning[]> {
    // Skip if minimal data
    if (!extractedData.weather && !extractedData.manpower && !extractedData.notes) {
      return [];
    }

    const prompt = `Analyze this extracted daily report data for inconsistencies or conflicts:

${JSON.stringify(extractedData, null, 2)}

Check for:
1. Weather notes contradicting conditions (e.g., notes mention rain but conditions say "Clear")
2. Work area statuses that conflict with each other
3. Any other logical inconsistencies

Return JSON with this structure:
{
  "conflicts": [
    {
      "type": "weather_inconsistency" | "work_area_conflict" | "cross_section_conflict" | "other",
      "message": "string describing the conflict",
      "sections": ["list", "of", "sections"],
      "severity": "info" | "warning" | "error"
    }
  ]
}

If no conflicts found, return: {"conflicts": []}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a data validation assistant. Analyze construction daily report data for inconsistencies. Be conservative - only flag clear conflicts, not minor variations.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return [];
      }

      const parsed = JSON.parse(content);
      return (parsed.conflicts || []).map(
        (c: {
          type: string;
          message: string;
          sections: string[];
          severity: string;
        }) => ({
          type: c.type as ValidationWarning['type'],
          message: c.message,
          sections: c.sections,
          severity: c.severity as ValidationWarning['severity'],
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Semantic conflict detection failed: ${message}`);
      return [];
    }
  }
}
