import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MessagingService } from './messaging.service';

/**
 * Module for SQS messaging operations.
 *
 * @remarks
 * Provides MessagingService for publishing messages to SQS queue.
 * Validates queue connectivity on module initialization (fail-fast).
 */
@Module({
  imports: [ConfigModule],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
