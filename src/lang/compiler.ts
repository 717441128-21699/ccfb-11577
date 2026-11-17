import type { Program } from './ast';
import { SkillScriptError } from './errors';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { renderSnippet } from './position';

export interface ParseResult {
  ok: boolean;
  program?: Program;
  errors: FormattedError[];
}

export interface FormattedError {
  phase: 'lex' | 'parse' | 'runtime';
  message: string;
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
  snippet: string;
  full: string;
}

export function formatError(err: unknown, source: string): FormattedError {
  if (err instanceof SkillScriptError) {
    const snippet = renderSnippet(source, err.pos, err.endPos);
    const phaseLabel = { lex: '词法错误', parse: '语法错误', runtime: '运行错误' }[err.phase];
    return {
      phase: err.phase,
      message: err.message,
      line: err.pos.line,
      col: err.pos.col,
      endLine: err.endPos?.line,
      endCol: err.endPos?.col,
      snippet,
      full: `${phaseLabel}（第 ${err.pos.line} 行 第 ${err.pos.col} 列）：${err.message}\n${snippet}`,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    phase: 'runtime',
    message,
    line: 0,
    col: 0,
    snippet: '',
    full: `运行错误：${message}`,
  };
}

/** 词法 + 语法分析，失败时返回带行列的错误而不是抛异常。 */
export function parseSource(source: string): ParseResult {
  try {
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parseProgram();
    return { ok: true, program, errors: [] };
  } catch (err) {
    return { ok: false, errors: [formatError(err, source)] };
  }
}
