import { useState } from 'react';
import { CodeEditor } from './CodeEditor';
import { useEditor, LIBRARY, EDGE_CASES } from './studio';

const SNIPPETS: { label: string; code: string }[] = [
  { label: '伤害技能', code: 'skill my_skill {\n  let dmg = stat(caster, "atk") - stat(target, "def") * 0.5;\n  damage(caster, target, dmg, "phys");\n}' },
  { label: '可叠层 buff', code: 'buff my_buff {\n  set_stacking("stack");\n  set_max_stacks(5);\n  set_duration(3);\n  mod_stat("atk", 8, "flat");\n}' },
  { label: '受击触发器', code: 'skill my_passive {\n  on "take_hit" {\n    damage(target, attacker, damage_amount * 0.3, "phys");\n  }\n}' },
  { label: '循环', code: 'skill multi_hit {\n  let i = 0;\n  while (i < 5) {\n    damage(caster, target, stat(caster, "atk") * 0.3, "phys");\n    i = i + 1;\n  }\n}' },
];

export function SkillEditorPage() {
  const editor = useEditor();
  const [showLib, setShowLib] = useState(false);

  return (
    <div className="page">
      <div className="grid-sidebar">
        <div className="card">
          <h3>技能编写</h3>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            顶层声明 <code className="mono">skill 名称 {'{}'}</code> 与{' '}
            <code className="mono">buff 名称 {'{}'}</code>；语句以 <code className="mono">;</code> 结束。
            触发器用 <code className="mono">on "hit"|"take_hit"|"turn_start"|"death" {'{}'}</code>。
          </p>
          <div className="row-gap">
            <h3>快速插入片段</h3>
            {SNIPPETS.map((s) => (
              <button
                key={s.label}
                className="ghost row"
                onClick={() => editor.setSource(editor.source + '\n\n' + s.code)}
              >
                + {s.label}
              </button>
            ))}
          </div>
          <div className="row-gap">
            <button className="ghost" onClick={() => setShowLib(!showLib)}>
              {showLib ? '收起' : '查看'}内置技能库（20 个技能）
            </button>
          </div>
          <div className="row-gap">
            <button
              className="ghost"
              onClick={() => editor.setSource(EDGE_CASES)}
              title="加载死循环/连锁超深演示"
            >
              加载异常演示脚本
            </button>
          </div>
          <div className="row-gap" style={{ fontSize: 12.5 }}>
            {editor.parseOk ? (
              <div className="ok-box">✓ 语法正确，可切换到「语法检查」看 AST，或到「战斗沙盘」试跑。</div>
            ) : (
              <div className="error-box">{editor.errors[0]?.full ?? '解析失败'}</div>
            )}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3>编辑器</h3>
          <div style={{ flex: 1, minHeight: 300 }}>
            <CodeEditor source={editor.source} onChange={editor.setSource} />
          </div>
          {showLib && (
            <div style={{ marginTop: 14, maxHeight: 280, overflow: 'auto' }}>
              <h3>library.ss</h3>
              <CodeEditor source={LIBRARY} readOnly />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
