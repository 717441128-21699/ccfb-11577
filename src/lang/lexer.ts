import { LexError } from './errors';
import type { Pos } from './position';
import { KEYWORDS, Token, TokenType } from './tokens';

const SINGLE_CHAR: Record<string, TokenType> = {
  '(': TokenType.LParen,
  ')': TokenType.RParen,
  '{': TokenType.LBrace,
  '}': TokenType.RBrace,
  '[': TokenType.LBracket,
  ']': TokenType.RBracket,
  ',': TokenType.Comma,
  ':': TokenType.Colon,
  ';': TokenType.Semicolon,
  '.': TokenType.Dot,
  '=': TokenType.Assign,
  '+': TokenType.Plus,
  '-': TokenType.Minus,
  '*': TokenType.Star,
  '/': TokenType.Slash,
  '%': TokenType.Percent,
  '<': TokenType.Lt,
  '>': TokenType.Gt,
};

/**
 * 词法分析器：把源码切分为 Token 流。
 * 支持 // 行注释、# 行注释、/* *\/ 块注释、数字、字符串、标识符与关键字。
 * 每个 Token 记录起止行列，报错可精确定位。
 */
export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly source: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;
      const start = this.currentPos();
      const ch = this.source[this.pos];

      if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.source[this.pos + 1] ?? ''))) {
        tokens.push(this.readNumber(start));
        continue;
      }
      if (ch === '"' || ch === "'") {
        tokens.push(this.readString(start, ch));
        continue;
      }
      if (this.isIdentStart(ch)) {
        tokens.push(this.readIdent(start));
        continue;
      }
      if (ch === '=' && this.peek() === '=') {
        this.advance(); this.advance();
        tokens.push(this.makeToken(TokenType.Eq, '==', start));
        continue;
      }
      if (ch === '!' && this.peek() === '=') {
        this.advance(); this.advance();
        tokens.push(this.makeToken(TokenType.NotEq, '!=', start));
        continue;
      }
      if (ch === '<' && this.peek() === '=') {
        this.advance(); this.advance();
        tokens.push(this.makeToken(TokenType.LtEq, '<=', start));
        continue;
      }
      if (ch === '>' && this.peek() === '=') {
        this.advance(); this.advance();
        tokens.push(this.makeToken(TokenType.GtEq, '>=', start));
        continue;
      }
      const type = SINGLE_CHAR[ch];
      if (type) {
        this.advance();
        tokens.push(this.makeToken(type, ch, start));
        continue;
      }
      throw new LexError(`无法识别的字符 "${ch}"`, start);
    }
    tokens.push({ type: TokenType.EOF, value: '', pos: this.currentPos(), endPos: this.currentPos() });
    return tokens;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
      } else if (ch === '/' && this.peek() === '/') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') this.advance();
      } else if (ch === '#') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') this.advance();
      } else if (ch === '/' && this.peek() === '*') {
        const start = this.currentPos();
        this.advance(); this.advance();
        while (this.pos < this.source.length && !(this.source[this.pos] === '*' && this.peek() === '/')) this.advance();
        if (this.pos >= this.source.length) {
          throw new LexError('块注释缺少结束符 */', start);
        }
        this.advance(); this.advance();
      } else {
        break;
      }
    }
  }

  private readNumber(start: Pos): Token {
    let text = '';
    let sawDot = false;
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (this.isDigit(ch)) {
        text += ch;
        this.advance();
      } else if (ch === '.' && !sawDot) {
        sawDot = true;
        text += ch;
        this.advance();
      } else {
        break;
      }
    }
    const n = Number(text);
    if (Number.isNaN(n)) throw new LexError(`非法数字 "${text}"`, start);
    return this.makeToken(TokenType.Number, text, start);
  }

  private readString(start: Pos, quote: string): Token {
    this.advance(); // 开引号
    let value = '';
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      const ch = this.source[this.pos];
      if (ch === '\n') throw new LexError('字符串不能跨行', this.currentPos());
      if (ch === '\\') {
        this.advance();
        const esc = this.source[this.pos];
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          default: throw new LexError(`非法转义字符 "\\${esc ?? ''}"`, this.currentPos());
        }
        this.advance();
      } else {
        value += ch;
        this.advance();
      }
    }
    if (this.pos >= this.source.length) throw new LexError('字符串缺少结束引号', start);
    this.advance(); // 闭引号
    return { type: TokenType.String, value, pos: start, endPos: this.currentPos() };
  }

  private readIdent(start: Pos): Token {
    let text = '';
    while (this.pos < this.source.length && this.isIdentPart(this.source[this.pos])) {
      text += this.source[this.pos];
      this.advance();
    }
    const kw = KEYWORDS[text];
    return this.makeToken(kw ?? TokenType.Ident, text, start);
  }

  private makeToken(type: TokenType, value: string, start: Pos): Token {
    return { type, value, pos: start, endPos: this.currentPos() };
  }

  private currentPos(): Pos {
    return { line: this.line, col: this.col, index: this.pos };
  }

  private peek(): string {
    return this.source[this.pos + 1] ?? '';
  }

  private advance(): void {
    if (this.source[this.pos] === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    this.pos++;
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}
