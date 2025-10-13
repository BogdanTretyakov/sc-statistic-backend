import type { Action } from 'w3gjs/dist/types/parsers/ActionParser';
import type {
  GameDataBlock,
  LeaveGameBlock,
  TimeslotBlock,
} from 'w3gjs/dist/types/parsers/GameDataParser';

export function isNotNil<T>(
  val: T | null | undefined,
): val is Exclude<T, null | undefined> {
  return typeof val === 'number' || val === false || !!val;
}

export const isTimeslotBlock = (val: GameDataBlock): val is TimeslotBlock =>
  val.id === 31 || val.id === 30;

export const isLeaveGameBlock = (val: GameDataBlock): val is LeaveGameBlock =>
  val.id === 0x17;

export const isTypedAction =
  <const T extends Action['id']>(id: T) =>
  (action: Action): action is Extract<Action, { id: T }> =>
    action.id === id;
