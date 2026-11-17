import { useRef } from 'react';

interface Props {
  source: string;
  onChange?: (s: string) => void;
  readOnly?: boolean;
  activeLine?: number;
  breakpoints?: Set<number>;
  onToggleBreakpoint?: (line: number) => void;
}

export function CodeEditor({ source, onChange, readOnly, activeLine, breakpoints, onToggleBreakpoint }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lines = source.split('\n');

  function syncScroll() {
    const gutter = document.getElementById('code-gutter');
    if (gutter && taRef.current) gutter.scrollTop = taRef.current.scrollTop;
  }

  return (
    <div className="code-area">
      <div className="gutter" id="code-gutter">
        {lines.map((_, i) => {
          const line = i + 1;
          const hasBp = breakpoints?.has(line);
          return (
            <span
              key={line}
              className={`line ${activeLine === line ? 'active' : ''}`}
              onClick={() => onToggleBreakpoint?.(line)}
              title={onToggleBreakpoint ? '点击切换断点' : undefined}
              style={{ cursor: onToggleBreakpoint ? 'pointer' : 'default' }}
            >
              {hasBp ? <span className="bp">●</span> : ''}
              {line}
            </span>
          );
        })}
      </div>
      <textarea
        ref={taRef}
        value={source}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
      />
    </div>
  );
}
