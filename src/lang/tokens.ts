import type { Pos } from './position';

export enum TokenType {
  // 字面量
  Number = 'Number',
  String = 'String',
  Bool = 'Bool',
  Ident = 'Ident',
  // 关键字
  Skill = 'skill',
  Buff = 'buff',
  On = 'on',
  Let = 'let',
  If = 'if',
  Else = 'else',
  While = 'while',
  Break = 'break',
  Continue = 'continue',
  Return = 'return',
  True = 'true',
  False = 'false',
  And = 'and',
  Or = 'or',
  Not = 'not',
  In = 'in',
  // 标点
  LParen = '(',
  RParen = ')',
  LBrace = '{',
  RBrace = '}',
  LBracket = '[',
  RBracket = ']',
  Comma = ',',
  Colon = ':',
  Semicolon = ';',
  Dot = '.',
  Assign = '=',
  Plus = '+',
  Minus = '-',
  Star = '*',
  Slash = '/',
  Percent = '%',
  Eq = '==',
  NotEq = '!=',
  Lt = '<',
  Gt = '>',
  LtEq = '<=',
  GtEq = '>=',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  pos: Pos;
  endPos: Pos;
}

export const KEYWORDS: Record<string, TokenType> = {
  skill: TokenType.Skill,
  buff: TokenType.Buff,
  on: TokenType.On,
  let: TokenType.Let,
  if: TokenType.If,
  else: TokenType.Else,
  while: TokenType.While,
  break: TokenType.Break,
  continue: TokenType.Continue,
  return: TokenType.Return,
  true: TokenType.Bool,
  false: TokenType.Bool,
  and: TokenType.And,
  or: TokenType.Or,
  not: TokenType.Not,
  in: TokenType.In,
};
