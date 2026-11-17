import type {
  Assignment,
  BinaryExpr,
  BinaryOp,
  BoolLiteral,
  BuffDecl,
  Decl,
  Expr,
  ExprStmt,
  IfStmt,
  Program,
  SkillDecl,
  Stmt,
  StringLiteral,
  TriggerBlock,
  TriggerKind,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from './ast';
import { ParseError } from './errors';
import type { Pos, Span } from './position';
import { Token, TokenType } from './tokens';

const TRIGGER_EVENTS: Record<string, TriggerKind> = {
  hit: 'on_hit',
  take_hit: 'on_take_hit',
  turn_start: 'on_turn_start',
  death: 'on_death',
};

/**
 * 递归下降语法分析器。
 * 表达式优先级（由低到高）：or → and → 相等 → 比较 → 加减 → 乘除取模 → 一元 → 调用/成员/下标 → 基础。
 */
export class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const decls: Decl[] = [];
    while (!this.isAtEnd()) {
      decls.push(this.parseDecl());
    }
    return { kind: 'Program', decls };
  }

  private parseDecl(): Decl {
    const tok = this.peek();
    if (tok.type === TokenType.Skill) return this.parseSkill();
    if (tok.type === TokenType.Buff) return this.parseBuff();
    throw new ParseError('顶层只允许 skill 或 buff 声明', tok.pos, tok.endPos);
  }

  private parseSkill(): SkillDecl {
    const start = this.advance();
    const nameTok = this.expect(TokenType.Ident, 'skill 后需要技能名称标识符');
    this.expect(TokenType.LBrace, '技能体需要 {');
    const body: Stmt[] = [];
    const triggers: TriggerBlock[] = [];
    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      if (this.check(TokenType.On)) {
        triggers.push(this.parseTrigger());
      } else {
        body.push(this.parseStmt());
      }
    }
    const end = this.expect(TokenType.RBrace, '技能体缺少 }');
    return { kind: 'SkillDecl', name: nameTok.value, body, triggers, span: this.span(start, end) };
  }

  private parseTrigger(): TriggerBlock {
    const start = this.advance(); // on
    const eventTok = this.expect(TokenType.String, 'on 后需要触发器事件字符串，如 "hit" / "take_hit" / "turn_start" / "death"');
    const event = TRIGGER_EVENTS[eventTok.value];
    if (!event) {
      throw new ParseError(
        `未知触发器事件 "${eventTok.value}"，可选：${Object.keys(TRIGGER_EVENTS).map((e) => `"${e}"`).join(', ')}`,
        eventTok.pos,
        eventTok.endPos,
      );
    }
    this.expect(TokenType.LBrace, '触发器需要 {');
    const body = this.parseStmtList();
    const end = this.expect(TokenType.RBrace, '触发器缺少 }');
    return { kind: 'TriggerBlock', event, body, span: this.span(start, end) };
  }

  private parseBuff(): BuffDecl {
    const start = this.advance();
    const nameTok = this.expect(TokenType.Ident, 'buff 后需要效果名称标识符');
    this.expect(TokenType.LBrace, 'buff 体需要 {');
    const body: Stmt[] = [];
    const triggers: TriggerBlock[] = [];
    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      if (this.check(TokenType.On)) {
        triggers.push(this.parseTrigger());
      } else {
        body.push(this.parseStmt());
      }
    }
    const end = this.expect(TokenType.RBrace, 'buff 体缺少 }');
    return { kind: 'BuffDecl', name: nameTok.value, body, triggers, span: this.span(start, end) };
  }

  private parseStmtList(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      stmts.push(this.parseStmt());
    }
    return stmts;
  }

  private parseStmt(): Stmt {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.Let:
        return this.parseVarDecl();
      case TokenType.If:
        return this.parseIf();
      case TokenType.While:
        return this.parseWhile();
      case TokenType.Break: {
        const t = this.advance();
        this.consumeTerminator();
        return { kind: 'BreakStmt', span: this.span(t, t) };
      }
      case TokenType.Continue: {
        const t = this.advance();
        this.consumeTerminator();
        return { kind: 'ContinueStmt', span: this.span(t, t) };
      }
      case TokenType.Return:
        return this.parseReturn();
      case TokenType.LBrace:
        throw new ParseError('不支持独立语句块，请把代码直接写在当前块内', tok.pos, tok.endPos);
      default:
        return this.parseExprOrAssign();
    }
  }

  private parseVarDecl(): VarDecl {
    const start = this.advance(); // let
    const name = this.expect(TokenType.Ident, 'let 后需要变量名').value;
    let init: Expr | null = null;
    if (this.match(TokenType.Assign)) {
      init = this.parseExpr();
    }
    this.consumeTerminator();
    return { kind: 'VarDecl', name, init, span: this.span(start, this.previous()) };
  }

  private parseIf(): IfStmt {
    const start = this.advance(); // if
    this.expect(TokenType.LParen, 'if 条件需要 (');
    const test = this.parseExpr();
    this.expect(TokenType.RParen, 'if 条件缺少 )');
    this.expect(TokenType.LBrace, 'if 体需要 {');
    const consequent = this.parseStmtList();
    this.expect(TokenType.RBrace, 'if 体缺少 }');
    let alternate: Stmt[] | null = null;
    if (this.match(TokenType.Else)) {
      if (this.match(TokenType.If)) {
        // else if 归一化为 else { if ... }
        const nested = this.parseIfTail();
        alternate = [nested];
      } else {
        this.expect(TokenType.LBrace, 'else 体需要 {');
        alternate = this.parseStmtList();
        this.expect(TokenType.RBrace, 'else 体缺少 }');
      }
    }
    return { kind: 'IfStmt', test, consequent, alternate, span: this.span(start, this.previous()) };
  }

  /** 已消费 "else if"，解析剩余部分并返回 IfStmt。 */
  private parseIfTail(): IfStmt {
    this.expect(TokenType.LParen, 'if 条件需要 (');
    const test = this.parseExpr();
    this.expect(TokenType.RParen, 'if 条件缺少 )');
    this.expect(TokenType.LBrace, 'if 体需要 {');
    const consequent = this.parseStmtList();
    this.expect(TokenType.RBrace, 'if 体缺少 }');
    let alternate: Stmt[] | null = null;
    if (this.match(TokenType.Else)) {
      if (this.match(TokenType.If)) {
        alternate = [this.parseIfTail()];
      } else {
        this.expect(TokenType.LBrace, 'else 体需要 {');
        alternate = this.parseStmtList();
        this.expect(TokenType.RBrace, 'else 体缺少 }');
      }
    }
    return { kind: 'IfStmt', test, consequent, alternate, span: this.span(this.previous(), this.previous()) };
  }

  private parseWhile(): WhileStmt {
    const start = this.advance(); // while
    this.expect(TokenType.LParen, 'while 条件需要 (');
    const test = this.parseExpr();
    this.expect(TokenType.RParen, 'while 条件缺少 )');
    this.expect(TokenType.LBrace, 'while 体需要 {');
    const body = this.parseStmtList();
    const end = this.expect(TokenType.RBrace, 'while 体缺少 }');
    return { kind: 'WhileStmt', test, body, span: this.span(start, end) };
  }

  private parseReturn(): Stmt {
    const start = this.advance(); // return
    let value: Expr | null = null;
    if (!this.check(TokenType.Semicolon) && !this.check(TokenType.RBrace)) {
      value = this.parseExpr();
    }
    this.consumeTerminator();
    return { kind: 'ReturnStmt', value, span: this.span(start, this.previous()) };
  }

  private parseExprOrAssign(): ExprStmt | Assignment {
    const startTok = this.peek();
    const expr = this.parseExpr();
    if (this.match(TokenType.Assign)) {
      if (expr.kind !== 'Identifier' && expr.kind !== 'MemberExpr' && expr.kind !== 'IndexExpr') {
        throw new ParseError('赋值目标必须是变量、成员或下标表达式', startTok.pos, expr.span.end);
      }
      const value = this.parseExpr();
      this.consumeTerminator();
      return { kind: 'Assignment', target: expr, value, span: this.span(startTok, this.previous()) };
    }
    this.consumeTerminator();
    return { kind: 'ExprStmt', expr, span: expr.span };
  }

  private consumeTerminator(): void {
    if (this.check(TokenType.RBrace) || this.isAtEnd()) return;
    this.expect(TokenType.Semicolon, '语句需要以 ; 结束');
  }

  // ---------- 表达式 ----------

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match(TokenType.Or)) {
      const opTok = this.previous();
      const right = this.parseAnd();
      left = this.binary('or', left, right, opTok);
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.match(TokenType.And)) {
      const opTok = this.previous();
      const right = this.parseEquality();
      left = this.binary('and', left, right, opTok);
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.check(TokenType.Eq) || this.check(TokenType.NotEq)) {
      const opTok = this.advance();
      const right = this.parseComparison();
      left = this.binary(opTok.value as BinaryOp, left, right, opTok);
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (this.check(TokenType.Lt) || this.check(TokenType.Gt) || this.check(TokenType.LtEq) || this.check(TokenType.GtEq)) {
      const opTok = this.advance();
      const right = this.parseAdditive();
      left = this.binary(opTok.value as BinaryOp, left, right, opTok);
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
      const opTok = this.advance();
      const right = this.parseMultiplicative();
      left = this.binary(opTok.value as BinaryOp, left, right, opTok);
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.check(TokenType.Star) || this.check(TokenType.Slash) || this.check(TokenType.Percent)) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = this.binary(opTok.value as BinaryOp, left, right, opTok);
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.check(TokenType.Minus) || this.check(TokenType.Not)) {
      const opTok = this.advance();
      const operand = this.parseUnary();
      const node: UnaryExpr = {
        kind: 'UnaryExpr',
        op: opTok.type === TokenType.Minus ? '-' : 'not',
        operand,
        span: this.span(opTok, operand.span.end),
      };
      return node;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.match(TokenType.LParen)) {
        const args: Expr[] = [];
        if (!this.check(TokenType.RParen)) {
          args.push(this.parseExpr());
          while (this.match(TokenType.Comma)) args.push(this.parseExpr());
        }
        const end = this.expect(TokenType.RParen, '函数调用缺少 )');
        expr = { kind: 'CallExpr', callee: expr, args, span: this.span(expr.span.start, end) };
      } else if (this.match(TokenType.LBracket)) {
        const index = this.parseExpr();
        const end = this.expect(TokenType.RBracket, '下标表达式缺少 ]');
        expr = { kind: 'IndexExpr', object: expr, index, span: this.span(expr.span.start, end) };
      } else if (this.match(TokenType.Dot)) {
        const propTok = this.expect(TokenType.Ident, '成员访问 . 后需要属性名');
        expr = { kind: 'MemberExpr', object: expr, property: propTok.value, span: this.span(expr.span.start, propTok) };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.Number: {
        this.advance();
        return { kind: 'NumberLiteral', value: Number(tok.value), span: this.span(tok, tok) };
      }
      case TokenType.String: {
        this.advance();
        const node: StringLiteral = { kind: 'StringLiteral', value: tok.value, span: this.span(tok, tok) };
        return node;
      }
      case TokenType.Bool: {
        this.advance();
        const node: BoolLiteral = { kind: 'BoolLiteral', value: tok.value === 'true', span: this.span(tok, tok) };
        return node;
      }
      case TokenType.Ident: {
        this.advance();
        return { kind: 'Identifier', name: tok.value, span: this.span(tok, tok) };
      }
      case TokenType.LParen: {
        this.advance();
        const expr = this.parseExpr();
        this.expect(TokenType.RParen, '括号表达式缺少 )');
        return expr;
      }
      case TokenType.LBracket: {
        this.advance();
        const elements: Expr[] = [];
        if (!this.check(TokenType.RBracket)) {
          elements.push(this.parseExpr());
          while (this.match(TokenType.Comma)) elements.push(this.parseExpr());
        }
        const end = this.expect(TokenType.RBracket, '数组缺少 ]');
        return { kind: 'ArrayExpr', elements, span: this.span(tok, end) };
      }
      default:
        throw new ParseError(`意外的符号 "${tok.value || tok.type}"`, tok.pos, tok.endPos);
    }
  }

  private binary(op: BinaryOp, left: Expr, right: Expr, _opTok: Token): BinaryExpr {
    void _opTok;
    return { kind: 'BinaryExpr', op, left, right, span: { start: left.span.start, end: right.span.end } };
  }

  // ---------- Token 游标工具 ----------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.tokens[this.current - 1];
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new ParseError(`${message}，实际遇到 "${tok.value || tok.type}"`, tok.pos, tok.endPos);
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private span(start: Token | Pos, end: Token | Pos): Span {
    const s = 'pos' in start && !('line' in start) ? start.pos : (start as Pos);
    const e = 'endPos' in end && end.endPos ? end.endPos : 'pos' in end && !('line' in end) ? end.pos : (end as Pos);
    return { start: s, end: e };
  }
}
