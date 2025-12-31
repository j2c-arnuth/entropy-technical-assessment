import { Injectable, Logger } from '@nestjs/common';
import {
  WeatherData,
  ManpowerData,
  Crew,
  WorkArea,
} from '../../shared/schemas/daily-report.schema';
import {
  StructuredExtractionResult,
  SectionExtractionResult,
  ExtractionConfidence,
} from '../interfaces/extraction-result.interface';

/**
 * Service for structured extraction of data from PDF text using regex patterns.
 *
 * @remarks
 * **Design Decision: Pattern-Based Primary Extraction**
 *
 * Uses regex patterns to identify and extract data from known Procore sections.
 *
 * Justification:
 * - Procore daily reports have consistent section headers and formatting
 * - Deterministic results for well-formatted content
 * - Faster and cheaper than LLM for standard cases
 * - Flags ambiguous content for LLM fallback
 *
 * Production Consideration:
 * Patterns should be refined based on actual Procore PDF samples. Consider
 * maintaining pattern configurations externally for easier updates.
 *
 * **Design Decision: Confidence-Based Fallback Triggering**
 *
 * Each section extraction includes a confidence level and fallback flag.
 *
 * Justification:
 * - Allows selective LLM usage only where needed
 * - Provides transparency about extraction quality
 * - Enables hybrid approach without over-relying on LLM
 */
@Injectable()
export class StructuredExtractorService {
  private readonly logger = new Logger(StructuredExtractorService.name);

  // Section header patterns (case-insensitive)
  private readonly sectionPatterns = {
    weather: /(?:^|\n)\s*(?:weather|observed weather|weather conditions)\s*[:\n]/i,
    manpower: /(?:^|\n)\s*(?:manpower|workforce|daily construction report|labor)\s*[:\n]/i,
    workAreas: /(?:^|\n)\s*(?:work\s*areas?|locations?|site\s*areas?)\s*[:\n]/i,
    notes: /(?:^|\n)\s*(?:notes?|observations?|comments?|remarks?)\s*[:\n]/i,
  };

  /**
   * Extract structured data from PDF text using pattern matching.
   *
   * @param pdfText - The raw text extracted from the PDF
   * @returns Structured extraction result with confidence indicators
   */
  extract(pdfText: string): StructuredExtractionResult {
    this.logger.log('Starting structured extraction');

    const result: StructuredExtractionResult = {
      weather: this.extractWeather(pdfText),
      manpower: this.extractManpower(pdfText),
      workAreas: this.extractWorkAreas(pdfText),
      notes: this.extractNotes(pdfText),
    };

    const sectionsNeedingFallback = Object.entries(result)
      .filter(([, section]) => section.needsLlmFallback)
      .map(([name]) => name);

    this.logger.log(
      `Structured extraction complete. Sections needing LLM fallback: ${
        sectionsNeedingFallback.length > 0
          ? sectionsNeedingFallback.join(', ')
          : 'none'
      }`,
    );

    return result;
  }

  /**
   * Extract weather data from PDF text.
   */
  private extractWeather(
    pdfText: string,
  ): SectionExtractionResult<WeatherData> {
    const sectionText = this.extractSectionText(pdfText, 'weather');

    if (!sectionText) {
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: false, // Section not present, not ambiguous
        rawText: undefined,
      };
    }

    try {
      // Pattern for temperature: "High: 75°F" or "Temperature: 65-75°F" or "75°/65°"
      const tempHighMatch = sectionText.match(
        /(?:high|max)[:\s]*(\d+)\s*°?[fFcC]?/i,
      );
      const tempLowMatch = sectionText.match(
        /(?:low|min)[:\s]*(\d+)\s*°?[fFcC]?/i,
      );

      // Alternative: "75°/65°" or "75-65°F"
      const tempRangeMatch = sectionText.match(
        /(\d+)\s*°?\s*[-\/]\s*(\d+)\s*°?[fFcC]?/,
      );

      let temperatureHigh: number | undefined;
      let temperatureLow: number | undefined;

      if (tempHighMatch) {
        temperatureHigh = parseInt(tempHighMatch[1], 10);
      } else if (tempRangeMatch) {
        temperatureHigh = Math.max(
          parseInt(tempRangeMatch[1], 10),
          parseInt(tempRangeMatch[2], 10),
        );
      }

      if (tempLowMatch) {
        temperatureLow = parseInt(tempLowMatch[1], 10);
      } else if (tempRangeMatch) {
        temperatureLow = Math.min(
          parseInt(tempRangeMatch[1], 10),
          parseInt(tempRangeMatch[2], 10),
        );
      }

      // Pattern for conditions: "Sky: Clear" or "Conditions: Partly Cloudy"
      const conditionsMatch = sectionText.match(
        /(?:sky|conditions?|weather)[:\s]*([A-Za-z\s]+?)(?:\n|,|;|$)/i,
      );
      const conditions = conditionsMatch
        ? conditionsMatch[1].trim()
        : undefined;

      // Notes: remaining text after structured fields
      const notes = this.extractRemainingNotes(sectionText, [
        tempHighMatch?.[0],
        tempLowMatch?.[0],
        tempRangeMatch?.[0],
        conditionsMatch?.[0],
      ]);

      // Determine confidence based on what we found
      const hasTemperature =
        temperatureHigh !== undefined || temperatureLow !== undefined;
      const hasConditions = conditions !== undefined && conditions.length > 0;

      let confidence: ExtractionConfidence;
      let needsLlmFallback: boolean;

      if (hasTemperature && hasConditions) {
        confidence = ExtractionConfidence.HIGH;
        needsLlmFallback = false;
      } else if (hasTemperature || hasConditions) {
        confidence = ExtractionConfidence.MEDIUM;
        needsLlmFallback = false;
      } else {
        confidence = ExtractionConfidence.LOW;
        needsLlmFallback = true;
      }

      return {
        data: {
          conditions: conditions || '',
          temperatureHigh: temperatureHigh || 0,
          temperatureLow: temperatureLow || 0,
          notes: notes || '',
        },
        confidence,
        needsLlmFallback,
        rawText: sectionText,
      };
    } catch (error) {
      this.logger.warn(`Weather extraction failed: ${error}`);
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: true,
        rawText: sectionText,
      };
    }
  }

  /**
   * Extract manpower data from PDF text.
   */
  private extractManpower(
    pdfText: string,
  ): SectionExtractionResult<ManpowerData> {
    const sectionText = this.extractSectionText(pdfText, 'manpower');

    if (!sectionText) {
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: false,
        rawText: undefined,
      };
    }

    try {
      const crews: Crew[] = [];

      // Pattern for crew entries: "Subcontractor Name - Trade - X workers"
      // or table rows: "ABC Corp | Electrician | 5 | 8hrs"
      const crewPatterns = [
        // "Company: X workers" or "Company - X workers"
        /([A-Za-z\s&]+?)[\s:\-]+(\d+)\s*(?:workers?|men|people|crew)/gi,
        // Table format: Company | Trade | Workers
        /([A-Za-z\s&]+?)\s*[|]\s*([A-Za-z\s]+?)\s*[|]\s*(\d+)/gi,
      ];

      for (const pattern of crewPatterns) {
        let match;
        while ((match = pattern.exec(sectionText)) !== null) {
          if (match.length >= 3) {
            crews.push({
              subcontractor: match[1].trim(),
              trade: match[2]?.trim() || 'General',
              count: parseInt(match[match.length - 1], 10) || parseInt(match[2], 10),
            });
          }
        }
      }

      // Pattern for total workers: "Total: X workers" or "Total Workers: X"
      const totalMatch = sectionText.match(
        /(?:total)[:\s]*(\d+)\s*(?:workers?|men|people)?/i,
      );
      let totalWorkers = totalMatch ? parseInt(totalMatch[1], 10) : 0;

      // If no explicit total, sum crew counts
      if (totalWorkers === 0 && crews.length > 0) {
        totalWorkers = crews.reduce((sum, crew) => sum + crew.count, 0);
      }

      const notes = this.extractRemainingNotes(sectionText, [totalMatch?.[0]]);

      // Determine confidence
      let confidence: ExtractionConfidence;
      let needsLlmFallback: boolean;

      if (crews.length > 0 || totalWorkers > 0) {
        confidence =
          crews.length > 0 ? ExtractionConfidence.HIGH : ExtractionConfidence.MEDIUM;
        needsLlmFallback = false;
      } else {
        confidence = ExtractionConfidence.LOW;
        needsLlmFallback = true;
      }

      return {
        data: {
          totalWorkers,
          crews,
          notes: notes || '',
        },
        confidence,
        needsLlmFallback,
        rawText: sectionText,
      };
    } catch (error) {
      this.logger.warn(`Manpower extraction failed: ${error}`);
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: true,
        rawText: sectionText,
      };
    }
  }

  /**
   * Extract work areas data from PDF text.
   */
  private extractWorkAreas(
    pdfText: string,
  ): SectionExtractionResult<WorkArea[]> {
    const sectionText = this.extractSectionText(pdfText, 'workAreas');

    if (!sectionText) {
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: false,
        rawText: undefined,
      };
    }

    try {
      const workAreas: WorkArea[] = [];

      // Pattern for work area entries: "Area Name: Status" or "Area Name - Status"
      const areaPatterns = [
        // "Building A: In Progress" or "Floor 2 - Complete"
        /([A-Za-z0-9\s]+?)[\s:\-]+\s*((?:in\s*progress|complete[d]?|pending|started|delayed|on\s*hold)[^\n]*)/gi,
        // Table format: Area | Status | Notes
        /([A-Za-z0-9\s]+?)\s*[|]\s*([A-Za-z\s]+?)(?:\s*[|]\s*([^\n|]+))?/gi,
      ];

      for (const pattern of areaPatterns) {
        let match;
        while ((match = pattern.exec(sectionText)) !== null) {
          const name = match[1].trim();
          const status = match[2].trim();
          const notes = match[3]?.trim() || '';

          // Avoid duplicate entries
          if (name && status && !workAreas.some((wa) => wa.name === name)) {
            workAreas.push({ name, status, notes });
          }
        }
      }

      // Determine confidence
      let confidence: ExtractionConfidence;
      let needsLlmFallback: boolean;

      if (workAreas.length > 0) {
        confidence = ExtractionConfidence.HIGH;
        needsLlmFallback = false;
      } else {
        confidence = ExtractionConfidence.LOW;
        needsLlmFallback = true;
      }

      return {
        data: workAreas.length > 0 ? workAreas : null,
        confidence,
        needsLlmFallback,
        rawText: sectionText,
      };
    } catch (error) {
      this.logger.warn(`Work areas extraction failed: ${error}`);
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: true,
        rawText: sectionText,
      };
    }
  }

  /**
   * Extract notes/observations from PDF text.
   */
  private extractNotes(pdfText: string): SectionExtractionResult<string> {
    const sectionText = this.extractSectionText(pdfText, 'notes');

    if (!sectionText) {
      return {
        data: null,
        confidence: ExtractionConfidence.LOW,
        needsLlmFallback: false,
        rawText: undefined,
      };
    }

    // For notes, we extract the raw text content
    const notes = sectionText.trim();

    return {
      data: notes.length > 0 ? notes : null,
      confidence:
        notes.length > 10 ? ExtractionConfidence.HIGH : ExtractionConfidence.MEDIUM,
      needsLlmFallback: false, // Notes are free-form, no need for LLM
      rawText: sectionText,
    };
  }

  /**
   * Extract section text from PDF based on section header pattern.
   * Returns text from section header to next section or end of document.
   */
  private extractSectionText(
    pdfText: string,
    sectionName: keyof typeof this.sectionPatterns,
  ): string | null {
    const pattern = this.sectionPatterns[sectionName];
    const match = pdfText.match(pattern);

    if (!match || match.index === undefined) {
      return null;
    }

    const startIndex = match.index + match[0].length;

    // Find next section header
    const remainingText = pdfText.substring(startIndex);
    const allPatterns = Object.values(this.sectionPatterns);
    let endIndex = remainingText.length;

    for (const nextPattern of allPatterns) {
      const nextMatch = remainingText.match(nextPattern);
      if (nextMatch && nextMatch.index !== undefined && nextMatch.index < endIndex) {
        endIndex = nextMatch.index;
      }
    }

    return remainingText.substring(0, endIndex).trim();
  }

  /**
   * Extract remaining text after removing matched patterns.
   */
  private extractRemainingNotes(
    text: string,
    matchedStrings: (string | undefined)[],
  ): string {
    let remaining = text;
    for (const matched of matchedStrings) {
      if (matched) {
        remaining = remaining.replace(matched, '');
      }
    }
    return remaining.trim();
  }
}
