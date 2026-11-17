import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DebugController } from '../runtime/debugger';
import type { BattleEngine } from '../runtime/battle';

interface SharedBattle {
  controller: DebugController;
  engine: BattleEngine;
  source: string;
  at: number;
}

interface Ctx {
  battle: SharedBattle | null;
  setBattle: (b: SharedBattle | null) => void;
}

const BattleContext = createContext<Ctx>({ battle: null, setBattle: () => {} });

export function BattleProvider({ children }: { children: ReactNode }) {
  const [battle, setBattle] = useState<SharedBattle | null>(null);
  return <BattleContext.Provider value={{ battle, setBattle }}>{children}</BattleContext.Provider>;
}

export function useBattle(): Ctx {
  return useContext(BattleContext);
}
