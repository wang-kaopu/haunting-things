import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { CodeBlock } from '@renderer/features/chat/components/CodeBlock';
import '@renderer/features/chat/components/markdown.css';

/** Agent 消息 Markdown 渲染所需的正文和附加样式。 */
export type MarkdownMessageProps = {
  content: string;
  className?: string;
};

const components: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },

  code({ className, children, ...props }) {
    const text = String(children ?? '');
    const match = /language-([\w-]+)/.exec(className ?? '');

    // 有语言标记，或内容中包含换行，就按代码块处理。
    // 没有语言的行内 code 继续走 <code>。
    const isBlock = Boolean(match) || text.includes('\n');

    if (!isBlock) {
      return (
        <code className="markdown-inline-code" {...props}>
          {children}
        </code>
      );
    }

    return (
      <CodeBlock
        code={text.replace(/\n$/, '')}
        language={match?.[1]}
      />
    );
  },
};

/** 渲染 Agent 消息 Markdown，并使用白名单清洗避免不可信 HTML 进入页面。 */
export function MarkdownMessage({
  content,
  className,
}: MarkdownMessageProps): React.ReactElement {
  return (
    <div className={className ? `markdown-message ${className}` : 'markdown-message'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
