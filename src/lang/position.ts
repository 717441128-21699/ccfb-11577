/** 源码位置：行列均从 1 开始，index 从 0 开始（用于切片）。 */
export interface Pos {
  line: number;
  col: number;
  index: number;
}

export interface Span {
  start: Pos;
  end: Pos;
}

/** 生成带源码片段和 ^ 光标的错误展示文本。 */
export function renderSnippet(source: string, pos: Pos, endPos?: Pos): string {
  const lines = source.split(/\r\n|\n|\r/);
  const lineText = lines[pos.line - 1] ?? '';
  const gutter = String(pos.line);
  const caretCount = Math.max(1, endPos && endPos.line === pos.line ? endPos.col - pos.col : 1);
  const caret = ' '.repeat(Math.max(0, pos.col - 1)) + '^'.repeat(Math.min(caretCount, Math.max(1, lineText.length - pos.col + 1)));
  return `  ${gutter} | ${lineText}\n  ${' '.repeat(gutter.length)} | ${caret}`;
}
