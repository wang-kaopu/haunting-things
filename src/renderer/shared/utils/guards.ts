export function isWrappedTeamPrompt(content: string): boolean {
  return (
    content.startsWith('You are ') &&
    content.includes('Current teammates:') &&
    content.includes('Available team RPC tools:')
  );
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
