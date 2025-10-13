import { Body, Controller, Get, Post, Render, UseGuards } from '@nestjs/common';
import type { MapVersion } from '@prisma/client';
import { PrismaService } from 'src/common/prisma.service';
import { AuthGuard } from 'src/admin/auth.guard';
import { WikiDataService } from 'src/common/wikiData.service';

@UseGuards(AuthGuard)
@Controller('/admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private wikiData: WikiDataService,
  ) {}

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
    const dataKeys = Object.keys(this.wikiData.data);
    const mapTypes = [
      ...new Set(dataKeys.map((s) => s.split('_')?.[0]).filter(Boolean)),
    ];

    return { items, dataKeys, mapTypes };
  }

  @Post('/')
  @Render('admin')
  async edit(@Body() body: MapVersion) {
    await this.prisma.mapVersion.update({
      where: { id: Number(body.id) },
      data: {
        mapType: body.mapType || null,
        mapVersion: body.mapVersion || null,
        mapPatch: body.mapPatch || null,
        dataKey: body.dataKey || null,
        ignore: Boolean(body.ignore),
      },
    });
    return this.render();
  }
}
