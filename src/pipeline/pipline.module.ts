import { Module } from '@nestjs/common';
import { FetcherService } from './fetcher.service';
import { MapperService } from './mapper.service';
import { ParserService } from './parser.service';
import { RequestsModule } from './requests.module';

@Module({
  providers: [FetcherService, MapperService, ParserService],
  imports: [RequestsModule],
  exports: [FetcherService, MapperService, ParserService],
})
export class PipelineModule {}
