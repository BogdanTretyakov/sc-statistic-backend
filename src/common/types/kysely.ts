import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const MatchPlatform = {
    W3Champions: "W3Champions"
} as const;
export type MatchPlatform = (typeof MatchPlatform)[keyof typeof MatchPlatform];
export const ProcessError = {
    BAD_MAP: "BAD_MAP",
    NO_MAPPING: "NO_MAPPING",
    PARSING_ERROR: "PARSING_ERROR"
} as const;
export type ProcessError = (typeof ProcessError)[keyof typeof ProcessError];
export const PlayerDataType = {
    BONUS: "BONUS",
    AURA: "AURA",
    ULTIMATE: "ULTIMATE"
} as const;
export type PlayerDataType = (typeof PlayerDataType)[keyof typeof PlayerDataType];
export const PlayerEvents = {
    INITIAL_RACE: "INITIAL_RACE",
    BAN_RACE: "BAN_RACE",
    REPICK_RACE: "REPICK_RACE",
    HERO_BUY: "HERO_BUY",
    BASE_UPGRADE: "BASE_UPGRADE",
    TOWER_UPGRADE: "TOWER_UPGRADE",
    UP_FORT2: "UP_FORT2",
    UP_FORT3: "UP_FORT3",
    UP_BARRACK2: "UP_BARRACK2",
    UP_BARRACK3: "UP_BARRACK3",
    UP_BARRACK4: "UP_BARRACK4",
    USE_ULTIMATE: "USE_ULTIMATE",
    UNIT_BUY: "UNIT_BUY",
    CANCEL_UPGRADE: "CANCEL_UPGRADE",
    BONUS_UPGRADE: "BONUS_UPGRADE"
} as const;
export type PlayerEvents = (typeof PlayerEvents)[keyof typeof PlayerEvents];
export type DatabaseDump = {
    id: string;
    date: Timestamp;
};
export type MapProcess = {
    id: Generated<string>;
    mapId: number | null;
    platform: MatchPlatform;
    filePath: string;
    mappingError: ProcessError | null;
    downloadError: number | null;
    processed: Generated<boolean>;
};
export type MapVersion = {
    id: Generated<number>;
    mapName: string;
    mapType: string | null;
    mapVersion: string | null;
    mapPatch: string | null;
    dataKey: string | null;
    bonusCount: Generated<number>;
    ignore: Generated<boolean>;
};
export type Match = {
    id: Generated<string>;
    duration: number;
    endAt: Timestamp;
    avgMmr: number | null;
    avgQuantile: number | null;
    hasLeavers: boolean;
    mapId: number;
    mapProcessId: string;
    platform: MatchPlatform;
    season: string;
};
export type MigrationCustom = {
    name: string;
    finishedAt: Timestamp | null;
    error: boolean | null;
};
export type PlatformPlayer = {
    id: Generated<number>;
    name: string;
    platform: MatchPlatform;
    lastMmr: number | null;
    lastSeenAt: Timestamp;
};
export type Player = {
    id: Generated<string>;
    matchId: string;
    platformPlayerId: number;
    place: number;
    /**
     * Milliseconds from match start
     */
    timeAlive: number;
    raceId: string;
    mmr: number | null;
    quantile: number | null;
};
export type PlayerData = {
    playerId: string;
    type: PlayerDataType;
    value: string;
};
export type PlayerEvent = {
    playerMatchId: string;
    eventType: PlayerEvents;
    eventId: string;
    /**
     * Milliseconds from match start
     */
    time: number;
};
export type W3ChampionsMatch = {
    id: string;
    time: Timestamp;
    season: string;
    /**
     * [W3ChampionsMatchPlayer[]]
     */
    players: unknown;
    mapProcessId: string | null;
};
export type WikiData = {
    dataKey: string;
    key: string;
    data: unknown;
    sha: string;
};
export type DB = {
    DatabaseDump: DatabaseDump;
    MapProcess: MapProcess;
    MapVersion: MapVersion;
    Match: Match;
    MigrationCustom: MigrationCustom;
    PlatformPlayer: PlatformPlayer;
    Player: Player;
    PlayerData: PlayerData;
    PlayerEvent: PlayerEvent;
    W3ChampionsMatch: W3ChampionsMatch;
    WikiData: WikiData;
};
