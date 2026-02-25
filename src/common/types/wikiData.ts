export interface WikiDataMapping {
  raceData: Record<string, RaceMapping>;
  races: string[];
  ultimates: Record<string, string[]>;
}

export interface RaceMapping {
  id: string;
  key: string;
  auras: string[];
  magic: string[];
  baseUpgrades: {
    melee: string;
    armor: string;
    range: string;
    wall: string;
  };
  towerUpgrades: string[];
  bonusUpgrades: string[];
  heroes: string[];
  bonuses: string[];
  buildings: {
    tower: string;
    fort: string[];
    barrack: string[];
  };
  units: {
    melee: string;
    range: string;
    mage: string;
    siege: string;
    air: string;
    catapult: string;
  };
  t1spell: string;
  t2spell: string;
  bonusPicker: string;
  // Record<itemId, bonusId>
  bonusByItemId: Record<string, string>;
}
