import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Interval } from '@nestjs/schedule';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import {
  DailyReport,
  DailyReportDocument,
  ExtractedData,
} from '../shared/schemas/daily-report.schema';
import { ReportStatus } from '../shared/constants/report-status.enum';
import { ProcessingMessage } from '../messaging/interfaces/processing-message.interface';
import { PdfParserService } from './services/pdf-parser.service';
import { StructuredExtractorService } from './services/structured-extractor.service';
import { LlmExtractorService } from './services/llm-extractor.service';
import {
  ExtractionResult,
  ExtractionConfidence,
  StructuredExtractionResult,
  ValidationWarning,
} from './interfaces/extraction-result.interface';

/**
 * Service for consuming SQS messages and orchestrating PDF extraction.
 *
 * @remarks
 * **Design Decision: Interval-Based Polling**
 *
 * Uses @nestjs/schedule @Interval decorator for SQS polling.
 *
 * Justification:
 * - Simple, NestJS-native approach
 * - Auto-starts on module initialization
 * - Easy to configure polling frequency
 *
 * Production Consideration:
 * Consider long-polling with ReceiveMessage WaitTimeSeconds for efficiency,
 * or use AWS Lambda with SQS trigger for serverless scaling.
 *
 * **Design Decision: Sequential Message Processing**
 *
 * Processes one message at a time within each polling interval.
 *
 * Justification:
 * - Simpler error handling and status management
 * - Appropriate for assessment scope
 * - Prevents overwhelming local resources
 *
 * Production Consideration:
 * Implement batch processing with concurrency controls, or use
 * horizontal scaling with multiple consumer instances.
 */
@Injectable()
export class ExtractionService implements OnModuleInit {
  private readonly logger = new Logger(ExtractionService.name);
  private sqsClient: SQSClient;
  private queueUrl: string;
  private isProcessing = false;

  constructor(
    private configService: ConfigService,
    @InjectModel(DailyReport.name)
    private dailyReportModel: Model<DailyReportDocument>,
    private pdfParserService: PdfParserService,
    private structuredExtractorService: StructuredExtractorService,
    private llmExtractorService: LlmExtractorService,
  ) {
    this.sqsClient = new SQSClient({
      region: this.configService.get<string>('AWS_REGION'),
      endpoint: this.configService.get<string>('SQS_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });
    this.queueUrl =
      this.configService.get<string>('SQS_QUEUE_URL') ||
      'http://localhost:9324/000000000000/daily-report-processing';
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Extraction service initialized, polling will start');
  }

  /**
   * Poll SQS queue for messages and process them.
   * Runs every 5 seconds.
   */
  @Interval(5000)
  async pollQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1, // Short poll for responsiveness
        VisibilityTimeout: 300, // 5 minutes to process
      });

      const response = await this.sqsClient.send(command);

      if (response.Messages && response.Messages.length > 0) {
        for (const message of response.Messages) {
          await this.processMessage(message);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Queue polling failed: ${errorMessage}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single SQS message.
   */
  private async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) {
      this.logger.warn('Received message without body or receipt handle');
      return;
    }

    let processingMessage: ProcessingMessage;
    try {
      processingMessage = JSON.parse(message.Body);
    } catch (error) {
      this.logger.error('Failed to parse message body as JSON');
      return;
    }

    const { reportId, s3Key } = processingMessage;
    this.logger.log(`Processing report ${reportId} from S3 key: ${s3Key}`);

    try {
      // 1. Update status to PROCESSING
      await this.updateReportStatus(reportId, ReportStatus.PROCESSING);

      // 2. Run extraction pipeline
      const result = await this.runExtractionPipeline(s3Key);

      // 3. Update report with extracted data
      await this.updateReportWithExtraction(reportId, result);

      // 4. Delete message from queue
      await this.deleteMessage(message.ReceiptHandle);

      this.logger.log(
        `Successfully processed report ${reportId}. ` +
          `Warnings: ${result.warnings.length}, ` +
          `LLM fallback sections: ${result.llmFallbackSections.length}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process report ${reportId}: ${errorMessage}`);

      // Update status to FAILED
      await this.updateReportStatus(reportId, ReportStatus.FAILED);

      // Don't delete message - let it retry or go to DLQ
    }
  }

  /**
   * Run the complete extraction pipeline.
   */
  private async runExtractionPipeline(s3Key: string): Promise<ExtractionResult> {
    const startTime = Date.now();
    const metadata: ExtractionResult['metadata'] = {
      pdfParseTime: 0,
      structuredExtractionTime: 0,
      llmProcessingTime: 0,
      conflictDetectionTime: 0,
      totalTime: 0,
    };

    // Step 1: Extract text from PDF
    const pdfStart = Date.now();
    const pdfText = await this.pdfParserService.extractText(s3Key);
    metadata.pdfParseTime = Date.now() - pdfStart;

    // Step 2: Run structured extraction
    const structuredStart = Date.now();
    const structuredResult = this.structuredExtractorService.extract(pdfText);
    metadata.structuredExtractionTime = Date.now() - structuredStart;

    // Step 3: Run LLM fallback for ambiguous sections
    const llmStart = Date.now();
    const { extractedData, llmFallbackSections } = await this.runLlmFallback(
      structuredResult,
    );
    metadata.llmProcessingTime = Date.now() - llmStart;

    // Step 4: Run conflict detection
    const conflictStart = Date.now();
    const warnings = await this.llmExtractorService.detectConflicts(extractedData);
    metadata.conflictDetectionTime = Date.now() - conflictStart;

    metadata.totalTime = Date.now() - startTime;

    // Determine overall confidence
    const overallConfidence = this.calculateOverallConfidence(structuredResult);

    return {
      data: extractedData,
      warnings,
      llmFallbackSections,
      overallConfidence,
      metadata,
    };
  }

  /**
   * Run LLM fallback for sections that need it.
   */
  private async runLlmFallback(
    structuredResult: StructuredExtractionResult,
  ): Promise<{ extractedData: ExtractedData; llmFallbackSections: string[] }> {
    const extractedData: ExtractedData = {};
    const llmFallbackSections: string[] = [];

    // Process weather
    if (structuredResult.weather.needsLlmFallback && structuredResult.weather.rawText) {
      llmFallbackSections.push('weather');
      const llmResult = await this.llmExtractorService.extractSection<
        ExtractedData['weather']
      >('weather', structuredResult.weather.rawText);
      extractedData.weather = llmResult.data || undefined;
    } else {
      extractedData.weather = structuredResult.weather.data || undefined;
    }

    // Process manpower
    if (structuredResult.manpower.needsLlmFallback && structuredResult.manpower.rawText) {
      llmFallbackSections.push('manpower');
      const llmResult = await this.llmExtractorService.extractSection<
        ExtractedData['manpower']
      >('manpower', structuredResult.manpower.rawText);
      extractedData.manpower = llmResult.data || undefined;
    } else {
      extractedData.manpower = structuredResult.manpower.data || undefined;
    }

    // Process work areas
    if (
      structuredResult.workAreas.needsLlmFallback &&
      structuredResult.workAreas.rawText
    ) {
      llmFallbackSections.push('workAreas');
      const llmResult = await this.llmExtractorService.extractSection<
        ExtractedData['workAreas']
      >('workAreas', structuredResult.workAreas.rawText);
      extractedData.workAreas = llmResult.data || undefined;
    } else {
      extractedData.workAreas = structuredResult.workAreas.data || undefined;
    }

    // Process notes (no LLM fallback needed for free-form text)
    extractedData.notes = structuredResult.notes.data || undefined;

    return { extractedData, llmFallbackSections };
  }

  /**
   * Calculate overall confidence based on individual section confidences.
   */
  private calculateOverallConfidence(
    structuredResult: StructuredExtractionResult,
  ): ExtractionConfidence {
    const confidences = [
      structuredResult.weather.confidence,
      structuredResult.manpower.confidence,
      structuredResult.workAreas.confidence,
      structuredResult.notes.confidence,
    ];

    const lowCount = confidences.filter(
      (c) => c === ExtractionConfidence.LOW,
    ).length;
    const highCount = confidences.filter(
      (c) => c === ExtractionConfidence.HIGH,
    ).length;

    if (lowCount >= 2) {
      return ExtractionConfidence.LOW;
    } else if (highCount >= 3) {
      return ExtractionConfidence.HIGH;
    } else {
      return ExtractionConfidence.MEDIUM;
    }
  }

  /**
   * Update report status in MongoDB.
   */
  private async updateReportStatus(
    reportId: string,
    status: ReportStatus,
  ): Promise<void> {
    await this.dailyReportModel.findByIdAndUpdate(reportId, { status });
  }

  /**
   * Update report with extraction results.
   */
  private async updateReportWithExtraction(
    reportId: string,
    result: ExtractionResult,
  ): Promise<void> {
    await this.dailyReportModel.findByIdAndUpdate(reportId, {
      status: ReportStatus.COMPLETED,
      extractedData: result.data,
      // Note: In production, also store warnings and metadata
    });
  }

  /**
   * Delete message from SQS queue.
   */
  private async deleteMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.sqsClient.send(command);
  }
}
