import { PlayerEvents } from '@prisma/client';

export const TIME_TO_COUNT_PLAYER_AS_LEAVER = 18 * 60 * 1000;
export const SAME_EVENT_LAG: Partial<Record<PlayerEvents, number>> & {
  default: number;
} = {
  [PlayerEvents.BASE_UPGRADE]: 18 * 1000,
  [PlayerEvents.TOWER_UPGRADE]: 75 * 1000,
  [PlayerEvents.UP_FORT2]: Infinity,
  [PlayerEvents.UP_FORT3]: Infinity,
  default: 1500,
};
