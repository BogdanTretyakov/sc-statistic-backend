import { Module } from '@nestjs/common';
import { PipelineModule } from './pipeline/pipline.module';
import { AdminModule } from './admin/admin.module';
import { CommonModule } from './common/common.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticModule } from './analytic/analytic.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ScheduleModule.forRoot({
      cronJobs: true,
      intervals: false,
      timeouts: false,
    }),

    CommonModule,
    AdminModule,
    PipelineModule,
    AnalyticModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
