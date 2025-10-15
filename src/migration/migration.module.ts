import { Module } from '@nestjs/common';
import { MigrationService } from './migration.service';

@Module({
  providers: [MigrationService],
})
export class MigrationModule {}
