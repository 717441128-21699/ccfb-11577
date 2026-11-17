import type { Stmt } from '../lang/ast';
import type { SSValue, UnitSnapshot } from './types';

export interface StepFrame {
  name: string;
  /** 技能/buff/触发器名字，便于 UI 展示调用栈。 */
  detail: string;
  depth: number;
}

export interface StepEvent {
  index: number;
  kind: 'step' | 'enter' | 'leave';
  stmt?: Stmt;
  line: number;
  col: number;
  /** 语句执行前的变量快照。 */
  varsBefore: Record<string, SSValue>;
  frames: StepFrame[];
  unitsBefore: UnitSnapshot[];
  /** 该语句产生的属性变更（step 事件在执行后填充）。 */
  changes: StepChange[];
  message?: string;
}

export interface StepChange {
  unitId: string;
  unitName: string;
  prop: string;
  oldValue: string;
  newValue: string;
  reason: string;
}
