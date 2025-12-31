import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DailyReport,
  DailyReportDocument,
} from '../shared/schemas/daily-report.schema';
import { ReportStatus } from '../shared/constants/report-status.enum';
import { UploadDailyReportDto } from '../shared/dto/upload-daily-report.dto';
import { S3StorageService } from './services/s3-storage.service';
import { MessagingService } from '../messaging/messaging.service';

/**
 * Service for handling daily report ingestion.
 *
 * @remarks
 * **Design Decision: Synchronous Upload Flow**
 *
 * Upload to S3, save to MongoDB, publish SQS in single request.
 *
 * Justification:
 * Simple request-response model, immediate feedback to client.
 *
 * Production Consideration:
 * For large files, use presigned URLs for direct S3 upload, then async metadata capture.
 *
 * **Design Decision: Ingestion Publishes SQS Message Directly**
 *
 * Ingestion module calls messaging service after successful upload.
 *
 * Justification:
 * Simpler flow, fewer round-trips, atomic operation from client perspective.
 *
 * Production Consideration:
 * Consider event-driven architecture with database change streams or outbox pattern
 * for guaranteed delivery.
 */
@Injectable()
export class IngestionService {
  constructor(
    @InjectModel(DailyReport.name)
    private dailyReportModel: Model<DailyReportDocument>,
    private s3StorageService: S3StorageService,
    private messagingService: MessagingService,
  ) {}

  /**
   * Upload and process a daily report PDF.
   *
   * @param file - The uploaded file from multer
   * @param dto - Metadata for the report
   * @returns The created DailyReport document
   */
  async uploadReport(
    file: Express.Multer.File,
    dto: UploadDailyReportDto,
  ): Promise<DailyReportDocument> {
    // 1. Generate S3 key
    const s3Key = this.s3StorageService.generateKey(file.originalname);

    // 2. Upload to S3
    await this.s3StorageService.uploadFile(file.buffer, s3Key, file.mimetype);

    // 3. Create MongoDB document with PENDING status
    const reportDate = dto.reportDate ? new Date(dto.reportDate) : new Date();

    const dailyReport = new this.dailyReportModel({
      tenant: dto.tenant,
      project: dto.project,
      subcontractor: dto.subcontractor,
      reportDate,
      s3Key,
      originalFilename: file.originalname,
      fileSize: file.size,
      status: ReportStatus.PENDING,
    });

    const savedReport = await dailyReport.save();

    // 4. Publish SQS message for processing
    await this.messagingService.publishProcessingMessage(
      savedReport._id.toString(),
      s3Key,
      dto.tenant,
      dto.project,
      dto.subcontractor,
    );

    // 5. Return created document
    return savedReport;
  }
}
