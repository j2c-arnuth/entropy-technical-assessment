import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyReport, DailyReportSchema } from './schemas/daily-report.schema';

/**
 * Shared module providing common schemas, DTOs, and utilities.
 *
 * Exports the MongooseModule with DailyReport schema for use by other modules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyReport.name, schema: DailyReportSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class SharedModule {}
