import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuthGuard } from './auth.guard';
import { StatusController } from './status.controller';
import { PipelineModule } from 'src/pipeline/pipline.module';

@Module({
  providers: [AuthGuard],
  controllers: [AdminController, StatusController],
  imports: [PipelineModule],
})
export class AdminModule {}
