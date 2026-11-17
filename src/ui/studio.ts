import { useMemo, useState } from 'react';
import librarySource from '../skills/library.ss?raw';
import edgeSource from '../skills/edge_cases.ss?raw';
import { parseSource, type FormattedError } from '../lang/compiler';
import { loadPrograms, runBattle, type LoadedPrograms, type CastOrder } from '../runtime/runner';
import { DebugController } from '../runtime/debugger';
import type { UnitSpec } from '../runtime/types';

export interface EditorState {
  source: string;
  setSource: (s: string) => void;
  errors: FormattedError[];
  parseOk: boolean;
}

/** 语法检查页/编辑页共用：实时解析当前源码。 */
export function useEditor(initial = librarySource): EditorState {
  const [source, setSource] = useState(initial);
  const result = useMemo(() => parseSource(source), [source]);
  return {
    source,
    setSource,
    errors: result.errors,
    parseOk: result.ok,
  };
}

export const LIBRARY = librarySource;
export const EDGE_CASES = edgeSource;

export function defaultUnits(): UnitSpec[] {
  return [
    {
      id: 'hero', name: '勇者', team: 1,
      maxHp: 500, maxMp: 100, atk: 100, def: 40, spd: 80,
      critRate: 25, critDmg: 50, dodge: 0, element: 'fire',
    },
    {
      id: 'enemy', name: '魔像', team: 2,
      maxHp: 500, maxMp: 100, atk: 90, def: 40, spd: 55,
      critRate: 10, critDmg: 50, dodge: 0, element: 'grass',
    },
  ];
}

export interface SandboxResult {
  ok: boolean;
  error?: string;
  controller?: DebugController;
  engine?: ReturnType<typeof runBattle>['engine'];
}

/** 战斗沙盘：把编辑中的脚本与技能库合并解析，按施法序列跑一场确定性战斗。 */
export function useSandbox() {
  const [seed, setSeed] = useState(42);
  const [units, setUnits] = useState<UnitSpec[]>(defaultUnits());
  const [casts, setCasts] = useState<CastOrder[]>([
    { casterId: 'hero', skillName: 'flame_slash', targetId: 'enemy' },
  ]);
  const [lastResult, setLastResult] = useState<SandboxResult | null>(null);

  function run(customSource: string): SandboxResult {
    let result: SandboxResult;
    try {
      const programs: LoadedPrograms = loadPrograms([
        { name: 'library', source: LIBRARY },
        { name: 'edge', source: EDGE_CASES },
        { name: 'editor', source: customSource },
      ]);
      const battle = runBattle(units, programs, casts, { seed });
      const controller = new DebugController(
        battle.interpreter.trace,
        battle.engine.logs,
        battle.engine.changes,
        battle.engine.snapshot(),
      );
      result = { ok: true, controller, engine: battle.engine };
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    setLastResult(result);
    return result;
  }

  return { seed, setSeed, units, setUnits, casts, setCasts, run, lastResult };
}
