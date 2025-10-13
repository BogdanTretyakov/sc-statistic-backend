import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Render,
  Res,
} from '@nestjs/common';
import { ProcessError } from '@prisma/client';
import type { Response } from 'express';
import { BufferedLogger } from 'src/common/bufferLogger.service';
import { PrismaService } from 'src/common/prisma.service';
import { WikiDataService } from 'src/common/wikiData.service';

@Controller('/status')
export class StatusController {
  constructor(
    private logger: BufferedLogger,
    private prisma: PrismaService,
    private wikiData: WikiDataService,
  ) {}

  @Get('/')
  @Render('status')
  async status() {
    const w3ChampionsMatchesFound = await this.prisma.w3ChampionsMatch.count();
    const w3ChampionsMatchesDownloaded =
      await this.prisma.w3ChampionsMatch.count({
        where: { mapProcessId: { not: null } },
      });
    const lastW3championsMatch = await this.prisma.w3ChampionsMatch.findFirst({
      orderBy: { time: 'desc' },
      select: { time: true, id: true, season: true },
    });
    const matchesParsed = await this.prisma.mapProcess.count({
      where: {
        processed: true,
      },
    });
    const matchesErrors = await this.prisma.mapProcess.count({
      where: {
        OR: [
          {
            downloadError: { not: null },
          },
          {
            mappingError: { not: null },
            AND: {
              mappingError: { not: ProcessError.NO_MAPPING },
            },
          },
        ],
      },
    });
    const dataKeys = Object.keys(this.wikiData.data);

    return {
      w3ChampionsMatchesFound,
      w3ChampionsMatchesDownloaded,
      lastW3championsMatch,
      matchesParsed,
      matchesErrors,
      dataKeys,
    };
  }

  @Get('/logs')
  @Header('Cache-Control', 'no-store')
  logs(@Query('json') json: string, @Res() res: Response) {
    const items = this.logger.getLogs().reverse();

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
