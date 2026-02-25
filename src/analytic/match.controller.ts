import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MatchRepository } from './match.repository';
import {
  PlayerSearchDto,
  SearchMatchesDto,
  SearchMatchByPlatformDto,
} from './lib/dto';

@Controller('/match')
export class MatchController {
  constructor(private repo: MatchRepository) {}

  @Get('/players')
  async players(@Query() { name }: PlayerSearchDto) {
    return this.repo.searchPlayerByName(name);
  }

  @Get('/player/:id')
  async player(@Param('id') id: string) {
    try {
      return await this.repo.getPlayer(Number(id));
    } catch (e) {
      throw new NotFoundException(`Player ${id} not found`);
    }
  }

  @Post('/filter')
  async filterMatch(@Body() dto: SearchMatchesDto) {
    return this.repo.searchMatches(dto);
  }

  @Get('/get/:platform/:id')
  async getMatchByPlatform(
    @Param() { id, platform }: SearchMatchByPlatformDto,
  ) {
    try {
      const { id: internalId } = await this.repo.findInternalIdByPlatform(
        id,
        platform,
      );
      return await this.repo.getMatch(BigInt(internalId));
    } catch (e) {
      throw new NotFoundException(
        `Match ${id} not found for platform ${platform}`,
      );
    }
  }
}
