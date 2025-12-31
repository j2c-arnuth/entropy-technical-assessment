import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { UploadDailyReportDto } from '../shared/dto/upload-daily-report.dto';
import { DailyReportResponseDto } from '../shared/dto/daily-report-response.dto';

/**
 * Controller for daily report ingestion endpoints.
 */
@Controller('reports')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  /**
   * Upload a daily report PDF.
   *
   * @param file - The PDF file (multipart form field: 'file')
   * @param dto - Report metadata (form fields: tenant, project, subcontractor, reportDate?)
   * @returns The created daily report
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadReport(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDailyReportDto,
  ): Promise<DailyReportResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are accepted');
    }

    const report = await this.ingestionService.uploadReport(file, dto);

    return {
      id: report._id.toString(),
      tenant: report.tenant,
      project: report.project,
      subcontractor: report.subcontractor,
      reportDate: report.reportDate,
      status: report.status,
      s3Key: report.s3Key,
      originalFilename: report.originalFilename,
      extractedData: report.extractedData,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
}
