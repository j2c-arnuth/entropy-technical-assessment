import { Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';

/**
 * Module for SQS messaging operations.
 *
 * @remarks
 * Currently provides a stub MessagingService. Full implementation will
 * include SQS client configuration and queue management.
 */
@Module({
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
