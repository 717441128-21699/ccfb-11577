import type { Span } from './position';

// ---------- 表达式 ----------

export interface NumberLiteral {
  kind: 'NumberLiteral';
  value: number;
  span: Span;
}
export interface StringLiteral {
  kind: 'StringLiteral';
  value: string;
  span: Span;
}
export interface BoolLiteral {
  kind: 'BoolLiteral';
  value: boolean;
  span: Span;
}
export interface Identifier {
  kind: 'Identifier';
  name: string;
  span: Span;
}
export interface MemberExpr {
  kind: 'MemberExpr';
  object: Expr;
  property: string;
  span: Span;
}
export interface IndexExpr {
  kind: 'IndexExpr';
  object: Expr;
  index: Expr;
  span: Span;
}
export interface CallExpr {
  kind: 'CallExpr';
  callee: Expr;
  args: Expr[];
  span: Span;
}
export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=' | 'and' | 'or';
export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}
export type UnaryOp = '-' | 'not';
export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: UnaryOp;
  operand: Expr;
  span: Span;
}
export interface ArrayExpr {
  kind: 'ArrayExpr';
  elements: Expr[];
  span: Span;
}

export type Expr =
  | NumberLiteral
  | StringLiteral
  | BoolLiteral
  | Identifier
  | MemberExpr
  | IndexExpr
  | CallExpr
  | BinaryExpr
  | UnaryExpr
  | ArrayExpr;

// ---------- 语句 ----------

export interface VarDecl {
  kind: 'VarDecl';
  name: string;
  init: Expr | null;
  span: Span;
}
export interface Assignment {
  kind: 'Assignment';
  target: Identifier | MemberExpr | IndexExpr;
  value: Expr;
  span: Span;
}
export interface IfStmt {
  kind: 'IfStmt';
  test: Expr;
  consequent: Stmt[];
  alternate: Stmt[] | null;
  span: Span;
}
export interface WhileStmt {
  kind: 'WhileStmt';
  test: Expr;
  body: Stmt[];
  span: Span;
}
export interface BreakStmt {
  kind: 'BreakStmt';
  span: Span;
}
export interface ContinueStmt {
  kind: 'ContinueStmt';
  span: Span;
}
export interface ReturnStmt {
  kind: 'ReturnStmt';
  value: Expr | null;
  span: Span;
}
export interface ExprStmt {
  kind: 'ExprStmt';
  expr: Expr;
  span: Span;
}

export type Stmt =
  | VarDecl
  | Assignment
  | IfStmt
  | WhileStmt
  | BreakStmt
  | ContinueStmt
  | ReturnStmt
  | ExprStmt;

// ---------- 顶层声明 ----------

export type TriggerKind = 'on_hit' | 'on_take_hit' | 'on_turn_start' | 'on_death';

export interface TriggerBlock {
  kind: 'TriggerBlock';
  event: TriggerKind;
  body: Stmt[];
  span: Span;
}

export interface SkillDecl {
  kind: 'SkillDecl';
  name: string;
  body: Stmt[];
  triggers: TriggerBlock[];
  span: Span;
}

export interface BuffDecl {
  kind: 'BuffDecl';
  name: string;
  body: Stmt[];
  triggers: TriggerBlock[];
  span: Span;
}

export type Decl = SkillDecl | BuffDecl;

export interface Program {
  kind: 'Program';
  decls: Decl[];
}
