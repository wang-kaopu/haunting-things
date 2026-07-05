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

const TOAST_TTL_MS = 10_000;
const CHAT_NOTIFICATION_TTL_MS = 12_000;

type PushChatNotificationInput = PushNotificationInput & {
  teamId?: string;
  slotId?: string;
  conversationId?: string;
};

/**
 * 管理全局通知和 Chat 面板内的局部通知。
 *
 * 错误、权限等系统级事件进入全局 toast；后台 Agent 终态和 Team 消息进入 Chat 局部通知。
 */
export function useNotifications({
  activeTeamId,
  activeSlotId,
  activeConversationId,
  agentsByConversation = {},
}: UseNotificationsInput = {}): UseNotificationsResult {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [chatItems, setChatItems] = useState<ChatNotification[]>([]);

  const push = useCallback((input: PushNotificationInput) => {
    const now = Date.now();
    const item: AppNotification = {
      id: crypto.randomUUID(),
      title: input.title,
      message: input.message,
      level: input.level ?? 'info',
      createdAt: now,
      expiresAt: now + TOAST_TTL_MS,
    };
    setItems((current) => [...current, item].slice(-6));
  }, []);

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

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const removeChat = useCallback((id: string) => {
    setChatItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const clearChat = useCallback(() => {
    setChatItems([]);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setItems((current) => current.filter((item) => item.expiresAt > now));
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

      if (event.type === 'agent.error' || event.type === 'agent.permission.request') {
        push({
          title: agent ? agent.name : 'Agent',
          message: formatAgentEvent(event),
          level,
        });
        return;
      }

      if (event.conversationId === activeConversationId) return;
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
  }, [activeConversationId, activeSlotId, activeTeamId, agentsByConversation, push, pushChat]);

  return { items, chatItems, push, pushChat, remove, removeChat, clear, clearChat };
}
