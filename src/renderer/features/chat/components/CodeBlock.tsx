import React, { useState } from 'react';

export type CodeBlockProps = {
  code: string;
  language?: string;
};

export function CodeBlock({ code, language }: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

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
