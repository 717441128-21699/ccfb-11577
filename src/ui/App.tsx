import { useState } from 'react';
import { BattleProvider } from './battleContext';
import { SkillEditorPage } from './SkillEditorPage';
import { SyntaxCheckPage } from './SyntaxCheckPage';
import { SandboxPage } from './SandboxPage';
import { BattleLogPage } from './BattleLogPage';
import { DebugPage } from './DebugPage';

type PageKey = 'editor' | 'syntax' | 'sandbox' | 'logs' | 'debug';

const TABS: { key: PageKey; label: string }[] = [
  { key: 'editor', label: '技能编写' },
  { key: 'syntax', label: '语法检查' },
  { key: 'sandbox', label: '战斗沙盘' },
  { key: 'logs', label: '结算日志' },
  { key: 'debug', label: '单步调试' },
];

export function App() {
  const [page, setPage] = useState<PageKey>('editor');
  return (
    <BattleProvider>
      <div className="app">
        <div className="topbar">
          <div className="brand">
            SkillScript Studio
            <small>回合制 RPG 技能脚本语言 · 解释器 · 调试台</small>
          </div>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${page === t.key ? 'active' : ''}`} onClick={() => setPage(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="main">
          {page === 'editor' && <SkillEditorPage />}
          {page === 'syntax' && <SyntaxCheckPage />}
          {page === 'sandbox' && <SandboxPage />}
          {page === 'logs' && <BattleLogPage />}
          {page === 'debug' && <DebugPage />}
        </div>
      </div>
    </BattleProvider>
  );
}
