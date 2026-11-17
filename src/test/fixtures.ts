import type { UnitSpec } from '../runtime/types';

let seq = 0;

export function makeUnit(overrides: Partial<UnitSpec> & Pick<UnitSpec, 'id' | 'name' | 'team'>): UnitSpec {
  seq++;
  return {
    maxHp: 500,
    maxMp: 100,
    atk: 100,
    def: 40,
    spd: 50 + seq,
    critRate: 25,
    critDmg: 50,
    dodge: 0,
    element: 'none',
    ...overrides,
  };
}

/** 标准对战阵容：红方 hero（火），蓝方 enemy（草）。 */
export function standardDuo(): UnitSpec[] {
  return [
    makeUnit({ id: 'hero', name: '勇者', team: 1, element: 'fire' }),
    makeUnit({ id: 'enemy', name: '魔像', team: 2, element: 'grass' }),
  ];
}

/** 三人阵容：红方 hero+cleric，蓝方 enemy。 */
export function trio(): UnitSpec[] {
  return [
    makeUnit({ id: 'hero', name: '勇者', team: 1, element: 'fire' }),
    makeUnit({ id: 'cleric', name: '牧师', team: 1, element: 'water' }),
    makeUnit({ id: 'enemy', name: '魔像', team: 2, element: 'grass' }),
  ];
}
