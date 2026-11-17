import type { TriggerKind } from '../lang/ast';

// ---------- 脚本值 ----------

export interface UnitRef {
  __unit: true;
  id: string;
}
export interface BuiltinFn {
  __builtin: true;
  name: string;
}

export type SSValue = number | boolean | string | SSValue[] | UnitRef | BuiltinFn | null;

export function isUnitRef(v: SSValue): v is UnitRef {
  return typeof v === 'object' && v !== null && '__unit' in v;
}

export function isBuiltin(v: SSValue): v is BuiltinFn {
  return typeof v === 'object' && v !== null && '__builtin' in v;
}

// ---------- 单位 ----------

export type StatName =
  | 'maxHp'
  | 'maxMp'
  | 'atk'
  | 'def'
  | 'spd'
  | 'critRate'
  | 'critDmg'
  | 'dodge';

export const STAT_NAMES: StatName[] = ['maxHp', 'maxMp', 'atk', 'def', 'spd', 'critRate', 'critDmg', 'dodge'];

export interface UnitSpec {
  id: string;
  name: string;
  team: number;
  maxHp: number;
  maxMp: number;
  /** 初始生命/法力，缺省等于上限。 */
  hp?: number;
  mp?: number;
  atk: number;
  def: number;
  spd: number;
  critRate: number;
  critDmg: number;
  dodge: number;
  element: string;
  passiveSkills?: string[];
}

export interface UnitRuntime {
  spec: UnitSpec;
  hp: number;
  mp: number;
  alive: boolean;
}

// ---------- Buff ----------

export type StackingRule = 'refresh' | 'stack' | 'separate';
export type ModMode = 'flat' | 'percent';

export interface StatMod {
  stat: StatName;
  value: number;
  mode: ModMode;
}

export interface ActiveBuff {
  instanceId: string;
  defName: string;
  displayName: string;
  ownerId: string;
  sourceId: string;
  stacks: number;
  maxStacks: number;
  duration: number; // 剩余回合数；-1 表示整场战斗
  stacking: StackingRule;
  mods: StatMod[];
  vars: Record<string, SSValue>;
  order: number;
}

// ---------- 日志与变更追踪 ----------

export interface ChangeRecord {
  index: number;
  stepIndex: number;
  unitId: string;
  unitName: string;
  prop: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

export type LogKind =
  | 'info'
  | 'cast'
  | 'damage'
  | 'heal'
  | 'dodge'
  | 'crit'
  | 'buff_add'
  | 'buff_refresh'
  | 'buff_stack'
  | 'buff_remove'
  | 'trigger'
  | 'death'
  | 'error';

export interface BattleLogEntry {
  index: number;
  stepIndex: number;
  turn: number;
  depth: number;
  kind: LogKind;
  message: string;
}

// ---------- 触发器事件 ----------

export interface BattleEvent {
  kind: TriggerKind;
  attackerId?: string;
  targetId?: string;
  amount?: number;
  element?: string;
  unitId?: string;
  killerId?: string;
  /** 由 fire_event 显式触发（用于技能级 on 块的过滤判断）。 */
  explicit?: boolean;
}

// ---------- 战斗配置 ----------

export interface BattleConfig {
  seed: number;
  /** 元素克制表：elementChart[攻击元素][防御元素] = 倍率。 */
  elementChart: Record<string, Record<string, number>>;
  maxTriggerDepth: number;
  maxLoopIterations: number;
}

export const DEFAULT_CONFIG: BattleConfig = {
  seed: 42,
  elementChart: {
    fire: { grass: 2, water: 0.5, fire: 0.75 },
    water: { fire: 2, grass: 0.5, water: 0.75 },
    grass: { water: 2, fire: 0.5, grass: 0.75 },
  },
  maxTriggerDepth: 32,
  maxLoopIterations: 10000,
};

export interface UnitSnapshot {
  id: string;
  name: string;
  team: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  alive: boolean;
  atk: number;
  def: number;
  spd: number;
  critRate: number;
  critDmg: number;
  dodge: number;
  buffs: { name: string; stacks: number; duration: number }[];
}
