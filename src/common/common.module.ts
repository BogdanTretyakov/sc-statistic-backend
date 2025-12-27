import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BufferedLogger } from './bufferLogger.service';
import { WikiDataService } from './wikiData.service';
import { KyselyService } from './kysely.service';

@Global()
@Module({
  providers: [PrismaService, BufferedLogger, WikiDataService, KyselyService],
  exports: [PrismaService, BufferedLogger, WikiDataService, KyselyService],
})
export class CommonModule {}
