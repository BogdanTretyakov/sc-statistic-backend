import { Module } from '@nestjs/common';
import { AnalyticController } from './analytic.controller';
import { AnalyticRepository } from './analytic.repository';
import { DumpService } from './dump.service';
import { MatchController } from './match.controller';
import { MatchRepository } from './match.repository';

@Module({
  controllers: [AnalyticController, MatchController],
  providers: [AnalyticRepository, MatchRepository, DumpService],
})
export class AnalyticModule {}
