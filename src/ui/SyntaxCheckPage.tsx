import { useMemo } from 'react';
import { CodeEditor } from './CodeEditor';
import { useEditor } from './studio';
import { parseSource } from '../lang/compiler';
import { Lexer } from '../lang/lexer';
import { TokenType } from '../lang/tokens';

function summarizeAst(source: string): { ok: boolean; text: string } {
  try {
    const tokens = new Lexer(source).tokenize();
    const lines: string[] = [];
    lines.push(`Token 流（${tokens.length - 1} 个有效 token）：`);
    for (const t of tokens) {
      if (t.type === TokenType.EOF) {
        lines.push(`  EOF @ ${t.pos.line}:${t.pos.col}`);
        continue;
      }
      lines.push(`  ${t.pos.line.toString().padStart(3)}:${t.pos.col.toString().padStart(3)}  ${String(t.type).padEnd(12)} ${t.value}`);
    }
    return { ok: true, text: lines.join('\n') };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) };
  }
}

export function SyntaxCheckPage() {
  const editor = useEditor();
  const tokens = useMemo(() => summarizeAst(editor.source), [editor.source]);

  return (
    <div className="page">
      <div className="grid-2">
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3>源码与错误定位</h3>
          <div style={{ flex: 1, minHeight: 280 }}>
            <CodeEditor source={editor.source} onChange={editor.setSource} activeLine={editor.errors[0]?.line} />
          </div>
          <div className="row-gap">
            {editor.parseOk ? (
              <div className="ok-box">
                ✓ 词法、语法分析全部通过。
                {editor.source.split('\n').length} 行源码，无错误。
              </div>
            ) : (
              editor.errors.map((e, i) => (
                <div key={i} className="error-box" style={{ marginBottom: 8 }}>{e.full}</div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h3>词法 Token / 语法结构</h3>
          <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0, color: 'var(--muted)' }}>
            {tokens.text}
          </pre>
          {editor.parseOk && (
            <div className="row-gap">
              <h3>顶层声明</h3>
              {editor.errors.length === 0 && (
                <DeclSummary source={editor.source} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeclSummary({ source }: { source: string }) {
  const result = useMemo(() => parseSource(source), [source]);

  if (!result.program) return null;
  return (
    <table>
      <thead>
        <tr><th>类型</th><th>名称</th><th>语句数</th><th>触发器</th></tr>
      </thead>
      <tbody>
        {result.program.decls.map((d) => (
          <tr key={d.name}>
            <td>{d.kind === 'SkillDecl' ? 'skill' : 'buff'}</td>
            <td className="mono">{d.name}</td>
            <td>{d.body.length}</td>
            <td className="mono">
              {d.kind === 'SkillDecl'
                ? d.triggers.map((t) => t.event).join(', ') || '—'
                : d.triggers.map((t) => t.event).join(', ') || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
