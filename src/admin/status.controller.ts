import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Render,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { BufferedLogger } from 'src/common/bufferLogger.service';
import { KyselyService } from 'src/common/kysely.service';
import { PrismaService } from 'src/common/prisma.service';
import { WikiDataService } from 'src/common/wikiData.service';

@Controller('/status')
export class StatusController {
  constructor(
    private logger: BufferedLogger,
    private prisma: PrismaService,
    private kysely: KyselyService,
    private wikiData: WikiDataService,
  ) {}

  @Get('/')
  @Render('status')
  async status() {
    const { id: w3cLastId, time: w3cLastTime } =
      await this.prisma.w3ChampionsMatch.findFirstOrThrow({
        orderBy: { time: 'desc' },
        select: { id: true, time: true },
      });

    const { w3ChampionsMatchesDownloaded, w3ChampionsMatchesFound } =
      await this.kysely
        .selectFrom('W3ChampionsMatch')
        .select((s) => [
          s.fn.count('id').as('w3ChampionsMatchesFound'),
          s.fn
            .count('id')

            .filterWhere('mapProcessId', 'is not', null)
            .as('w3ChampionsMatchesDownloaded'),
        ])
        .executeTakeFirstOrThrow();

    const dataKeys = Object.keys(this.wikiData.data);

    const lastW3cMatch = {
      id: w3cLastId,
      time: w3cLastTime.toISOString(),
    };

    const replaysStatus = await this.kysely
      .selectFrom('MapProcess')
      .select((eb) => [
        eb.fn.count<number>('id').as('total'),
        eb.fn
          .count<number>('id')
          .filterWhere('processed', '=', false)
          .filterWhere('downloadError', 'is', null)
          .filterWhere('mappingError', 'is', null)
          .as('pending'),
        eb.fn
          .count<number>('id')
          .filterWhere('processed', '=', true)
          .as('done'),
        eb.fn
          .count<number>('id')
          .filterWhere('downloadError', 'is not', null)
          .as('downloadError'),
        eb.fn
          .count<number>('id')
          .filterWhere('mappingError', 'is not', null)
          .as('mappingError'),
      ])
      .executeTakeFirstOrThrow();

    return {
      w3ChampionsMatchesFound,
      w3ChampionsMatchesDownloaded,
      lastW3cMatch,
      replaysStatus,
      dataKeys,
    };
  }

  @Get('/logs')
  @Header('Cache-Control', 'no-store')
  logs(@Query('json') json: string, @Res() res: Response) {
    const items = this.logger.getLogs();

    if (json === undefined) {
      return res.render('logs', { items });
    }

    return res.json({ items });
  }

  @Get('/dataKey/:key')
  dataKey(@Param('key') key: string) {
    return this.wikiData.data[key];
  }
}
