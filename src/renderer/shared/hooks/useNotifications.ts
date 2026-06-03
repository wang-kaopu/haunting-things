import { useCallback, useEffect, useState } from 'react';
import type { TeamAgent } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import type { AppNotification, PushNotificationInput, RuntimeNotificationContext } from '@renderer/shared/types/ui';
import { normalizeAgentEvent, normalizeTeamMessageEvent } from '@renderer/shared/utils/backendData';
import { formatAgentEvent, shouldShowAgentEventInToast } from '@renderer/shared/utils/format';

/** 通知 Hook 需要的运行时上下文。 */
export type UseNotificationsInput = RuntimeNotificationContext;

/** 前端通知列表和操作方法。 */
export type UseNotificationsResult = {
  items: AppNotification[];
  push: (input: PushNotificationInput) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const TOAST_TTL_MS = 10_000;

/**
 * 管理右上角 toast 通知。
 *
 * 只把需要用户关注的 Agent 终态事件和未处理 Team 消息推到通知流，避免流式事件刷屏。
 */
export function useNotifications({
  activeAgentsByConversation = {},
}: UseNotificationsInput = {}): UseNotificationsResult {
  const [items, setItems] = useState<AppNotification[]>([]);

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

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setItems((current) => current.filter((item) => item.expiresAt > now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubAgentEvent = bridge.on('conversation.agentEvent', (payload) => {
      const event = normalizeAgentEvent(payload);
      if (!event) return;
      if (!shouldShowAgentEventInToast(event)) return;
      const agent = activeAgentsByConversation[event.conversationId] as TeamAgent | undefined;
      const level = event.type === 'agent.error' ? 'error' : event.type === 'agent.permission.request' ? 'warning' : 'success';
      push({
        title: agent ? agent.name : 'Agent',
        message: formatAgentEvent(event),
        level,
      });
    });
    const unsubTeamMessage = bridge.on('team.agent.message', (payload) => {
      const event = normalizeTeamMessageEvent(payload);
      if (!event || event.entry.processed) return;
      push({
        title: `${event.entry.fromAgentName} → ${event.entry.toAgentName}`,
        message: event.entry.message.summary || event.entry.message.content,
        level: 'info',
      });
    });

    return () => {
      unsubAgentEvent();
      unsubTeamMessage();
    };
  }, [activeAgentsByConversation, push]);

  return { items, push, remove, clear };
}
