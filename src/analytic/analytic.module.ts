import { Module } from '@nestjs/common';
import { AnalyticController } from './analytic.controller';
import { AnalyticRepository } from './analytic.repository';
import { DumpService } from './dump.service';

@Module({
  controllers: [AnalyticController],
  providers: [AnalyticRepository, DumpService],
})
export class AnalyticModule {}
