import React, { useState } from 'react';

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
        <button type="button" onClick={() => void copyCode()}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
