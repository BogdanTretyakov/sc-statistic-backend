import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MatchRepository } from './match.repository';
import { PlayerSearchDto, SearchMatchesDto } from './lib/dto';

@Controller('/match')
export class MatchController {
  constructor(private repo: MatchRepository) {}

  @Get('/players')
  async players(@Query() { name }: PlayerSearchDto) {
    return this.repo.searchPlayerByName(name);
  }

  @Post('/filter')
  async filterMatch(@Body() dto: SearchMatchesDto) {
    return this.repo.searchMatches(dto);
  }

  @Get('/events/:id')
  async getMatchEvents(@Param('id') id: string) {
    const matchId = BigInt(id);
    return this.repo.getMatchEvents(matchId);
  }
}
