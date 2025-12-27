import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { AnalyticRepository } from './analytic.repository';
import { DumpService } from './dump.service';
import { BaseAnalyticDto, BaseRaceDto } from './lib/dto';
import type { Request, Response } from 'express';
import { NotModifiedException } from 'src/common/utils/nest';
import dayjs from 'dayjs';

@Controller('/analytic')
export class AnalyticController {
  constructor(
    private repo: AnalyticRepository,
    private dump: DumpService,
  ) {}

  @Get('/dump')
  @Header('Cache-Control', 'public, max-age=0, must-revalidate')
  async dumpGet(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dump = await this.dump.getLastDump();
    if (!dump) throw new NotFoundException('No dump found');

    const etag = dump.id;
    const lastModified = dump.date.toUTCString();

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];

    if (ifNoneMatch === etag) {
      throw new NotModifiedException();
    }
    if (ifModifiedSince && new Date(ifModifiedSince) >= dump.date) {
      throw new NotModifiedException();
    }

    const [stream, size] = await this.dump.getDumpStream(dump.id);
    if (!stream) throw new NotFoundException('Dump file not found');

    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Content-length', size);

    const userFileName = `surv_chaos_stats_dump_${dayjs(dump.date).format('YYYY_MM_DD_HH_mm_ss')}.zip`;

    return new StreamableFile(stream, {
      disposition: `attachment; filename="${userFileName}"`,
      type: 'application/zip',
    });
  }

  @Get('/meta')
  async meta() {
    return this.repo.getMetaData();
  }

  @Get('/meta-patch')
  async patchMeta(@Query() dto: BaseAnalyticDto) {
    return this.repo.getPatchMetaData(dto);
  }

  @Get('/races')
  async races(@Query() dto: BaseAnalyticDto) {
    return this.repo.getRacesData(dto);
  }

  @Get('/race')
  async raceData(@Query() dto: BaseRaceDto) {
    return this.repo.getRaceData(dto);
  }
}
