import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BufferedLogger } from './bufferLogger.service';
import { WikiDataService } from './wikiData.service';
import { TaggedMemoryCache } from './tagCacheManager.service';
import { KyselyService } from './kysely.service';

@Global()
@Module({
  providers: [
    PrismaService,
    BufferedLogger,
    WikiDataService,
    TaggedMemoryCache,
    KyselyService,
  ],
  exports: [
    PrismaService,
    BufferedLogger,
    WikiDataService,
    TaggedMemoryCache,
    KyselyService,
  ],
})
export class CommonModule {}
