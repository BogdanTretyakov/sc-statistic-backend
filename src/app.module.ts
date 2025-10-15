import { Module } from '@nestjs/common';
import { PipelineModule } from './pipeline/pipline.module';
import { AdminModule } from './admin/admin.module';
import { CommonModule } from './common/common.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticModule } from './analytic/analytic.module';
import { AppController } from './app.controller';
import { MigrationModule } from './migration/migration.module';

@Module({
  imports: [
    ScheduleModule.forRoot({
      cronJobs: process.env.NODE_ENV === 'production',
      timeouts: true,
    }),
    CommonModule,
    AdminModule,
    PipelineModule,
    AnalyticModule,
    MigrationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
