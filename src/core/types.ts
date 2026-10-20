// core 全体で使う基本の型。

export type Position = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';
/** 打順に入る守備位置。DH は守らない。 */
export type LineupPosition = Exclude<Position, 'P'> | 'DH';
export type Hand = 'R' | 'L';
export type PitchType =
  | 'fastball'
  | 'slowball'
  | 'twoseam'
  | 'cutter'
  | 'shoot'
  | 'curve'
  | 'knucklecurve'
  | 'slider'
  | 'fork'
  | 'changeup'
  | 'palm';

export const FIELD_POSITIONS: readonly Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const PITCH_TYPES: readonly PitchType[] = ['fastball', 'slowball', 'twoseam', 'cutter', 'shoot', 'curve', 'knucklecurve', 'slider', 'fork', 'changeup', 'palm'];

export const POSITION_LABEL: Record<LineupPosition | 'P', string> = {
  P: '投',
  C: '捕',
  '1B': '一',
  '2B': '二',
  '3B': '三',
  SS: '遊',
  LF: '左',
  CF: '中',
  RF: '右',
  DH: '指'
};
