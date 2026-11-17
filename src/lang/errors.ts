import type { Pos } from './position';

export type ErrorPhase = 'lex' | 'parse' | 'runtime';

/** 所有 SkillScript 错误的基类，携带行列信息。 */
export class SkillScriptError extends Error {
  phase: ErrorPhase;
  pos: Pos;
  endPos?: Pos;

  constructor(phase: ErrorPhase, message: string, pos: Pos, endPos?: Pos) {
    super(message);
    this.name = 'SkillScriptError';
    this.phase = phase;
    this.pos = pos;
    this.endPos = endPos;
  }

  get line(): number {
    return this.pos.line;
  }
  get col(): number {
    return this.pos.col;
  }
}

export class LexError extends SkillScriptError {
  constructor(message: string, pos: Pos) {
    super('lex', message, pos);
    this.name = 'LexError';
  }
}

export class ParseError extends SkillScriptError {
  constructor(message: string, pos: Pos, endPos?: Pos) {
    super('parse', message, pos, endPos);
    this.name = 'ParseError';
  }
}

export class RuntimeError extends SkillScriptError {
  constructor(message: string, pos: Pos, endPos?: Pos) {
    super('runtime', message, pos, endPos);
    this.name = 'RuntimeError';
  }
}

/** 触发器连锁超过深度上限。 */
export class TriggerDepthError extends SkillScriptError {
  chain: string[];
  constructor(message: string, pos: Pos, chain: string[]) {
    super('runtime', message, pos);
    this.name = 'TriggerDepthError';
    this.chain = chain;
  }
}
