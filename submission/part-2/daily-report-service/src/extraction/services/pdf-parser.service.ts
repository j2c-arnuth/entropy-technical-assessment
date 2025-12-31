import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PDFParse } from 'pdf-parse';

/**
 * Service for downloading and parsing PDF files from S3.
 *
 * @remarks
 * **Design Decision: Self-Contained S3 Client**
 *
 * This service maintains its own S3 client rather than sharing with ingestion.
 *
 * Justification:
 * - Keeps extraction module independent and self-contained
 * - Avoids circular dependencies between modules
 * - Follows the same configuration pattern as other services
 *
 * Production Consideration:
 * Consider extracting S3 client to a shared infrastructure module to reduce
 * duplication and centralize AWS configuration.
 *
 * **Design Decision: Buffer-Based Processing**
 *
 * Downloads entire PDF into memory before parsing.
 *
 * Justification:
 * - pdf-parse requires buffer input
 * - Daily report PDFs are typically small (< 10MB)
 * - Simpler than streaming for this use case
 *
 * Production Consideration:
 * For large PDFs, consider streaming approaches or size limits with
 * appropriate error handling.
 */
@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);
  private s3Client: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION'),
      endpoint: this.configService.get<string>('S3_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
      forcePathStyle: true, // Required for LocalStack compatibility
    });
    this.bucket = this.configService.get<string>('S3_BUCKET') || 'daily-reports';
  }

  /**
   * Download a PDF from S3 and extract its text content.
   *
   * @param s3Key - The S3 object key of the PDF file
   * @returns The extracted text content from the PDF
   * @throws Error if download or parsing fails
   */
  async extractText(s3Key: string): Promise<string> {
    this.logger.log(`Extracting text from PDF: ${s3Key}`);

    // Download PDF from S3
    const buffer = await this.downloadFromS3(s3Key);

    // Parse PDF and extract text
    const text = await this.parsePdf(buffer);

    this.logger.log(
      `Extracted ${text.length} characters from PDF: ${s3Key}`,
    );

    return text;
  }

  /**
   * Download a file from S3 as a buffer.
   *
   * @param s3Key - The S3 object key
   * @returns The file content as a Buffer
   * @throws Error if download fails
   */
  private async downloadFromS3(s3Key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });

    try {
      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error(`Empty response body for S3 object: ${s3Key}`);
      }

      // Convert readable stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to download from S3: ${s3Key} - ${message}`);
      throw new Error(`S3 download failed for ${s3Key}: ${message}`);
    }
  }

  /**
   * Parse a PDF buffer and extract text content.
   *
   * @param buffer - The PDF file content
   * @returns The extracted text
   * @throws Error if parsing fails
   */
  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return result.text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to parse PDF: ${message}`);
      throw new Error(`PDF parsing failed: ${message}`);
    }
  }
}
