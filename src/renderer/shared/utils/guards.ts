/**
 * 判断消息是否为 TeamService 注入给 Agent 的包装 prompt。
 */
export function isWrappedTeamPrompt(content: string): boolean {
  return (
    content.startsWith('You are ') &&
    content.includes('Current teammates:') &&
    content.includes('Available team RPC tools:')
  );
}

/**
 * 判断未知值是否为去除空白后仍有内容的字符串。
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
