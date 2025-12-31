import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
import { ExtractionService } from './extraction.service';
import { PdfParserService } from './services/pdf-parser.service';
import { StructuredExtractorService } from './services/structured-extractor.service';
import { LlmExtractorService } from './services/llm-extractor.service';

/**
 * Extraction module for processing daily report PDFs.
 *
 * @remarks
 * This module provides:
 * - SQS message consumption via ExtractionService
 * - PDF text extraction via PdfParserService
 * - Structured data extraction via StructuredExtractorService
 * - LLM-based fallback and conflict detection via LlmExtractorService
 *
 * The extraction pipeline uses a hybrid approach:
 * 1. Structured extraction (regex/patterns) as primary method
 * 2. LLM fallback for ambiguous sections
 * 3. LLM-based conflict detection for validation
 */
@Module({
  imports: [ConfigModule, SharedModule],
  providers: [
    ExtractionService,
    PdfParserService,
    StructuredExtractorService,
    LlmExtractorService,
  ],
  exports: [ExtractionService],
})
export class ExtractionModule {}
