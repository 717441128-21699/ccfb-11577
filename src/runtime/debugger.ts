import type { StepEvent } from './trace';
import type { BattleLogEntry, ChangeRecord, UnitSnapshot } from './types';

/**
 * 调试控制器：一次完整运行会产生全量 trace，调试器在 trace 上做单步/断点/回放，
 * 因此“单步看到的每一步改了谁的哪个属性”与真实结算顺序严格一致。
 */
export class DebugController {
  private cursor = -1;
  readonly breakpoints = new Set<number>();

  constructor(
    readonly trace: StepEvent[],
    readonly logs: BattleLogEntry[],
    readonly changes: ChangeRecord[],
    readonly finalUnits: UnitSnapshot[],
  ) {}

  get current(): StepEvent | null {
    return this.trace[this.cursor] ?? null;
  }

  get position(): number {
    return this.cursor;
  }

  get totalSteps(): number {
    return this.trace.length;
  }

  /** 单步进入下一条语句。 */
  step(): StepEvent | null {
    if (this.cursor < this.trace.length - 1) this.cursor++;
    return this.current;
  }

  /** 回退一步（时间轴回看，不重新执行）。 */
  stepBack(): StepEvent | null {
    if (this.cursor > 0) this.cursor--;
    return this.current;
  }

  /** 运行到下一个断点；没有断点则跑到结束。 */
  runToBreakpoint(): StepEvent | null {
    let next = this.cursor;
    while (next < this.trace.length - 1) {
      next++;
      if (this.breakpoints.has(this.trace[next].line)) {
        this.cursor = next;
        return this.current;
      }
    }
    this.cursor = this.trace.length - 1;
    return this.current;
  }

  reset(): void {
    this.cursor = -1;
  }

  toggleBreakpoint(line: number): void {
    if (this.breakpoints.has(line)) this.breakpoints.delete(line);
    else this.breakpoints.add(line);
  }

  /** 当前步（含）之前产生的日志。 */
  logsUpToHere(): BattleLogEntry[] {
    const step = this.current;
    if (!step) return [];
    return this.logs.filter((l) => l.stepIndex <= step.index);
  }

  /** 当前步（含）之前的全部属性变更。 */
  changesUpToHere(): ChangeRecord[] {
    const step = this.current;
    if (!step) return [];
    return this.changes.filter((c) => c.stepIndex <= step.index);
  }

  /** 当前语句直接引起的变更。 */
  changesAtCurrent(): StepEvent['changes'] {
    return this.current?.changes ?? [];
  }

  unitsAtCurrent(): UnitSnapshot[] {
    return this.current?.unitsBefore ?? this.finalUnits;
  }
}
