import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AuthGuard } from './auth.guard';
import { StatusController } from './status.controller';

@Module({
  providers: [AuthGuard],
  controllers: [AdminController, StatusController],
})
export class AdminModule {}
