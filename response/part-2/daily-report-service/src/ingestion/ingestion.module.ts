import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { S3StorageService } from './services/s3-storage.service';
import { SharedModule } from '../shared/shared.module';
import { MessagingModule } from '../messaging/messaging.module';

/**
 * Module for daily report ingestion.
 *
 * Handles file upload, S3 storage, and metadata persistence.
 * Triggers message publishing for async processing.
 */
@Module({
  imports: [ConfigModule, SharedModule, MessagingModule],
  controllers: [IngestionController],
  providers: [IngestionService, S3StorageService],
  exports: [IngestionService],
})
export class IngestionModule {}
