import React, { useState } from 'react';
import { Button } from '@renderer/shared/components/ui/button';

/** Markdown 代码块的源码文本与可选语言标记。 */
export type CodeBlockProps = {
  code: string;
  language?: string;
};

/** 渲染 Markdown 代码块，并提供复制按钮方便复用 Agent 输出。 */
export function CodeBlock({ code, language }: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  /** 复制代码内容，并短暂显示成功态给用户确认。 */
  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span>{language || 'text'}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto border border-white/15 bg-white/5 px-2 py-[3px] text-xs font-normal text-slate-200 hover:bg-white/10 hover:text-slate-200"
          onClick={() => void copyCode()}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>

      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
