export interface W3CMatches {
  count: number;
  matches: W3CMatch[];
}

export interface W3CMatch {
  id: string;
  endTime: string;
  season: number;
  teams: Array<{
    players: Array<{
      battleTag: string;
      oldMmr: number;
      oldMmrQuantile: number;
      currentMmr: number;
    }>;
  }>;
}
