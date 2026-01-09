import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
}
