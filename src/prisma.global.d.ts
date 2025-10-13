export {};

declare global {
  namespace PrismaJson {
    type W3ChampionsMatchPlayer = {
      name: string;
      mmr: number;
      quantile: number;
    };
  }
}
