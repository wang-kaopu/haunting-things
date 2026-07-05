import { useCallback, useEffect, useState } from 'react';
import { bridge } from '@renderer/shared/bridgeClient';
import type {
  AppNotification,
  ChatNotification,
  PushNotificationInput,
  RuntimeNotificationContext,
} from '@renderer/shared/types/ui';
import { normalizeAgentEvent, normalizeTeamMessageEvent } from '@renderer/shared/utils/backendData';
import { formatAgentEvent, shouldShowAgentEventInToast } from '@renderer/shared/utils/format';

/** 通知 Hook 需要的运行时上下文。 */
export type UseNotificationsInput = RuntimeNotificationContext;

/** 前端通知列表和操作方法。 */
export type UseNotificationsResult = {
  items: AppNotification[];
  chatItems: ChatNotification[];
  push: (input: PushNotificationInput) => void;
  pushChat: (input: PushChatNotificationInput) => void;
  remove: (id: string) => void;
  removeChat: (id: string) => void;
  clear: () => void;
  clearChat: () => void;
};

const CHAT_NOTIFICATION_TTL_MS = 12_000;

type PushChatNotificationInput = PushNotificationInput & {
  teamId?: string;
  slotId?: string;
  conversationId?: string;
};

/**
 * 管理 Workbench 内的应用通知。
 *
 * 所有通知都进入内容区局部层，避免在整个页面右上角渲染全局 toast。
 */
export function useNotifications({
  activeTeamId,
  activeSlotId,
  activeConversationId,
  agentsByConversation = {},
}: UseNotificationsInput = {}): UseNotificationsResult {
  const [chatItems, setChatItems] = useState<ChatNotification[]>([]);

  const pushChat = useCallback((input: PushChatNotificationInput) => {
    const now = Date.now();
    const item: ChatNotification = {
      id: crypto.randomUUID(),
      title: input.title,
      message: input.message,
      level: input.level ?? 'info',
      teamId: input.teamId,
      slotId: input.slotId,
      conversationId: input.conversationId,
      createdAt: now,
      expiresAt: now + CHAT_NOTIFICATION_TTL_MS,
    };
    setChatItems((current) => [...current, item].slice(-6));
  }, []);

  const push = useCallback((input: PushNotificationInput) => {
    pushChat(input);
  }, [pushChat]);

  const remove = useCallback((id: string) => {
    setChatItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const removeChat = useCallback((id: string) => {
    setChatItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setChatItems([]);
  }, []);

  const clearChat = useCallback(() => {
    setChatItems([]);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setChatItems((current) => current.filter((item) => item.expiresAt > now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubAgentEvent = bridge.on('conversation.agentEvent', (payload) => {
      const event = normalizeAgentEvent(payload);
      if (!event) return;
      if (!shouldShowAgentEventInToast(event)) return;
      const context = agentsByConversation[event.conversationId];
      const agent = context?.agent;
      const level = event.type === 'agent.error' ? 'error' : event.type === 'agent.permission.request' ? 'warning' : 'success';

      if (event.conversationId === activeConversationId && event.type === 'agent.done') return;
      pushChat({
        title: agent ? agent.name : 'Agent',
        message: formatAgentEvent(event),
        level,
        teamId: context?.teamId,
        slotId: context?.slotId,
        conversationId: event.conversationId,
      });
    });
    const unsubTeamMessage = bridge.on('team.agent.message', (payload) => {
      const event = normalizeTeamMessageEvent(payload);
      if (!event || event.entry.processed) return;
      if (event.teamId === activeTeamId && event.entry.message.toAgentId === activeSlotId) return;
      pushChat({
        title: `${event.entry.fromAgentName} → ${event.entry.toAgentName}`,
        message: event.entry.message.summary || event.entry.message.content,
        level: 'info',
        teamId: event.teamId,
        slotId: event.entry.message.toAgentId,
      });
    });

    return () => {
      unsubAgentEvent();
      unsubTeamMessage();
    };
  }, [activeConversationId, activeSlotId, activeTeamId, agentsByConversation, pushChat]);

  return { items: chatItems, chatItems, push, pushChat, remove, removeChat, clear, clearChat };
}
