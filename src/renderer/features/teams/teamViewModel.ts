import type { Team, TeamMailboxEntry } from '@shared/types';

/** Team 发送框最终会调用的 bridge RPC。 */
export type TeamSendInvocation =
  | { name: 'team.sendMessage'; params: { teamId: string; content: string; files?: string[] } }
  | { name: 'team.sendMessageToAgent'; params: { teamId: string; slotId: string; content: string; files?: string[] } };

/** Team 发送框提交的正文和附件 ID。 */
export type TeamSendPayload = {
  content: string;
  files?: string[];
};

/**
 * 根据当前选中的成员决定 Team 发送目标。
 *
 * 选中 teammate 时表示用户要直接私发该成员；选中 leader 时走 Team 默认入口。
 */
export function resolveTeamSendInvocation(
  team: Team | undefined,
  activeSlotId: string | undefined,
  payload: string | TeamSendPayload
): TeamSendInvocation | null {
  if (!team || !activeSlotId) return null;
  const content = typeof payload === 'string' ? payload : payload.content;
  const files = typeof payload === 'string' ? undefined : payload.files;
  const agent = team.agents.find((item) => item.slotId === activeSlotId);
  if (agent?.role === 'teammate') {
    return {
      name: 'team.sendMessageToAgent',
      params: withFiles({ teamId: team.id, slotId: agent.slotId, content }, files),
    };
  }
  return {
    name: 'team.sendMessage',
    params: withFiles({ teamId: team.id, content }, files),
  };
}

/**
 * 只在存在附件 ID 时向 bridge 参数追加 files 字段。
 */
function withFiles<T extends { content: string }>(params: T, files: string[] | undefined): T & { files?: string[] } {
  return files && files.length > 0 ? { ...params, files } : params;
}

/**
 * 合并 Team mailbox 实时事件，保持同一消息的处理状态可被更新。
 */
export function mergeTeamMailboxEntries(current: TeamMailboxEntry[], nextEntry: TeamMailboxEntry): TeamMailboxEntry[] {
  const index = current.findIndex((item) => item.message.id === nextEntry.message.id);
  if (index < 0) return [...current, nextEntry];
  const next = [...current];
  next[index] = nextEntry;
  return next;
}
