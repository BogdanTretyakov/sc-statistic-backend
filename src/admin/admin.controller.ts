import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Render,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { MapVersion } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { AuthGuard } from 'src/admin/auth.guard';
import { access, readdir, rm } from 'fs/promises';
import { resolve } from 'path';
import chunk from 'lodash/chunk';
import { FilesDTO } from './lib/dto';
import type { Request } from 'express';
import { isNotNil } from 'src/pipeline/lib/guards';

@UseGuards(AuthGuard)
@Controller('/admin')
export class AdminController {
  private logger = new Logger(AdminController.name);

  constructor(private prisma: PrismaService) {}

  @Get('/')
  @Render('admin')
  async render() {
    const items = await this.prisma.mapVersion.findMany({
      orderBy: [
        {
          mapType: {
            sort: 'asc',
            nulls: 'first',
          },
        },
        {
          mapVersion: {
            sort: 'desc',
            nulls: 'first',
          },
        },
      ],
      include: {
        _count: {
          select: {
            Match: true,
          },
        },
      },
    });
    const dataKeys = (
      await this.prisma.wikiData.findMany({
        distinct: ['dataKey'],
        select: { dataKey: true },
      })
    ).map(({ dataKey }) => dataKey);
    const mapTypes = [
      ...new Set(dataKeys.map((s) => s.split('_')?.[0]).filter(Boolean)),
    ];

    return { items, dataKeys, mapTypes };
  }

  @Post('/')
  @Render('admin')
  async edit(@Body() body: MapVersion) {
    const { mapName } = await this.prisma.mapVersion.update({
      where: { id: Number(body.id) },
      data: {
        mapType: body.mapType || null,
        mapVersion: body.mapVersion || null,
        mapPatch: body.mapPatch || null,
        dataKey: body.dataKey || null,
        ignore: Boolean(body.ignore),
      },
      select: { mapName: true },
    });
    this.logger.log(`Updated mapping for ${mapName}`);
    return this.render();
  }

  @Get('/files')
  @Render('files')
  async renderFiles() {
    const showing = 1000;
    const allFiles = await readdir(
      resolve(process.cwd(), 'storage', 'replays'),
    );
    const files = allFiles.slice(0, showing);
    const replays = Array<{
      name: string;
      platform: string;
      reason: string;
      clearOnly?: boolean;
    }>();

    const dbStats = await this.prisma.mapProcess.findMany({
      where: { filePath: { in: files } },
      select: {
        filePath: true,
        processed: true,
        mappingError: true,
        downloadError: true,
        platform: true,
      },
    });

    const dbMap = Object.fromEntries(
      dbStats.map((item) => [item.filePath, item]),
    );

    for (const file of files) {
      const dbItem = dbMap[file];
      if (!dbItem) {
        replays.push({
          name: file,
          platform: 'Unknown',
          reason: 'Orphan',
        });
        continue;
      }

      const { mappingError, downloadError, platform, processed } = dbItem;
      if (!processed && !mappingError && !downloadError) {
        continue;
      }
      const reason = (() => {
        if (mappingError) return `${mappingError}`;
        if (downloadError) return `Download: ${downloadError}`;
        if (processed) return 'Processed';
        return 'Unknown';
      })();

      replays.push({ name: file, platform, reason });
    }

    for (const filesPart of chunk(allFiles, showing)) {
      const downloadErrors = await this.prisma.mapProcess.findMany({
        where: {
          filePath: { notIn: filesPart },
          downloadError: { not: null },
          AND: {
            downloadError: { not: 500 },
          },
        },
      });

      for (const file of downloadErrors) {
        replays.push({
          name: file.filePath,
          platform: file.platform,
          reason: `Download: ${file.downloadError}`,
          clearOnly: true,
        });
      }
    }

    replays.sort((a, b) => (a.reason < b.reason ? -1 : 1));

    return { replays, total: allFiles.length, showing };
  }

  @Post('/files')
  @Render('files')
  async deleteFiles(@Body() body: FilesDTO, @Req() req: Request) {
    const base = resolve(process.cwd(), 'storage', 'replays');
    const [remove, clear] = [body.remove, body.clear].map((items) =>
      [items].flat().filter(isNotNil),
    );
    for (const file of remove) {
      try {
        await access(resolve(base, file));
        await rm(resolve(base, file));
      } catch (e) {
        // noop
      }
    }
    if (remove.length) {
      this.logger.log(
        `Removed raw replays by admin ${req.ips[0] ?? req.ip}:\n${remove.join('\n')}`,
      );
    }
    for (const files of chunk(clear, 50)) {
      await this.prisma.$transaction(async (prisma) => {
        const mapProcess = await prisma.mapProcess.findMany({
          where: { filePath: { in: files } },
          select: { id: true },
        });

        const matches = await prisma.match.findMany({
          where: { mapProcessId: { in: mapProcess.map((item) => item.id) } },
          select: { id: true },
        });
        const players = await prisma.player.findMany({
          where: { matchId: { in: matches.map((item) => item.id) } },
          select: { id: true },
        });
        await prisma.playerEvent.deleteMany({
          where: { playerMatchId: { in: players.map(({ id }) => id) } },
        });
        await prisma.player.deleteMany({
          where: { id: { in: players.map(({ id }) => id) } },
        });
        await prisma.match.deleteMany({
          where: { id: { in: matches.map(({ id }) => id) } },
        });
        await prisma.mapProcess.updateMany({
          where: { id: { in: mapProcess.map((item) => item.id) } },
          data: {
            mappingError: null,
            downloadError: null,
            processed: false,
          },
        });
      });
    }
    if (clear.length) {
      this.logger.log(
        `Cleared replays state by admin ${req.ips[0] ?? req.ip}:\n${clear.join('\n')}`,
      );
    }
    return this.renderFiles();
  }
}
