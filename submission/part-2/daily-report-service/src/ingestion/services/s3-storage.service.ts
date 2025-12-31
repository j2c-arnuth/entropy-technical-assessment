import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for S3 file storage operations.
 *
 * @remarks
 * **Design Decision: S3 Key Generation Strategy**
 *
 * Uses `{date}/{uuid}/{original-filename}` pattern.
 *
 * Justification:
 * - Date prefix enables partitioning and lifecycle policies
 * - UUID prevents key collisions
 * - Original filename preserved for reference
 *
 * Production Consideration:
 * Add tenant/project prefixes for multi-tenant isolation and access control policies.
 *
 * **Design Decision: No Bucket Auto-Creation**
 *
 * Assumes S3 bucket exists (created via infrastructure setup).
 *
 * Justification:
 * Separation of concerns - infrastructure provisioning vs application logic.
 *
 * Production Consideration:
 * Use IaC (Terraform, CloudFormation) for bucket provisioning with proper policies.
 */
@Injectable()
export class S3StorageService {
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
   * Generate a unique S3 key for the file.
   *
   * @param originalFilename - The original filename from the upload
   * @returns S3 key in format: {date}/{uuid}/{filename}
   */
  generateKey(originalFilename: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const uuid = uuidv4();
    return `${date}/${uuid}/${originalFilename}`;
  }

  /**
   * Upload a file to S3.
   *
   * @param buffer - File content as Buffer
   * @param key - S3 object key
   * @param contentType - MIME type of the file
   * @returns The S3 key of the uploaded file
   * @throws Error if upload fails
   */
  async uploadFile(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);
    return key;
  }
}
