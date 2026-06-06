import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentEvent, AgentTurnPhase, ChatMessage, Team, TeamAgent } from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import { resolveTeamSendInvocation } from '@renderer/features/teams/teamViewModel';
import type { SendBoxPayload } from '@renderer/features/chat/components/SendBox';
import { normalizeAgentEvent, normalizeAgentEventList, normalizeConversationStream, normalizeMessageList } from '@renderer/shared/utils/backendData';
import { phaseFromAgentEvent } from '@renderer/shared/utils/format';

const MAX_AGENT_EVENTS_IN_MEMORY = 200;

/** 当前会话流 Hook 需要的活动团队和 Agent。 */
export type UseConversationStreamInput = {
  activeTeam: Team | null;
  activeAgent: TeamAgent | null;
};

/** 当前会话流 Hook 暴露的消息、事件、阶段和发送控制入口。 */
export type UseConversationStreamResult = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  agentEvents: AgentEvent[];
  loading: boolean;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  sendTeamMessage: (payload: SendBoxPayload) => Promise<void>;
  cancelCurrentTurn: () => Promise<void>;
  phaseByConversation: Record<string, AgentTurnPhase>;
};

/** 订阅当前 Agent 会话的消息流和事件流，并封装团队发送入口。 */
export function useConversationStream({
  activeTeam,
  activeAgent,
}: UseConversationStreamInput): UseConversationStreamResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentEventsByConversation, setAgentEventsByConversation] = useState<Record<string, AgentEvent[]>>({});
  const [phaseByConversation, setPhaseByConversation] = useState<Record<string, AgentTurnPhase>>({});
  const activeConversationRef = useRef(activeAgent?.conversationId ?? null);

  useEffect(() => {
    activeConversationRef.current = activeAgent?.conversationId ?? null;
  }, [activeAgent?.conversationId]);

  useEffect(() => {
    const unsubStream = bridge.on('conversation.stream', (payload) => {
      const event = normalizeConversationStream(payload);
      if (!event || event.conversationId !== activeConversationRef.current) return;
      setMessages((current) => mergeStreamMessage(current, event.message));
    });

    const unsubAgentEvent = bridge.on('conversation.agentEvent', (payload) => {
      const event = normalizeAgentEvent(payload);
      if (!event) return;
      setAgentEventsByConversation((prev) => {
        const list = prev[event.conversationId] ?? [];
        return {
          ...prev,
          [event.conversationId]: [...list, event].slice(-MAX_AGENT_EVENTS_IN_MEMORY),
        };
      });
      setPhaseByConversation((prev) => ({
        ...prev,
        [event.conversationId]: phaseFromAgentEvent(event),
      }));
    });

    return () => {
      unsubStream();
      unsubAgentEvent();
    };
  }, []);

  useEffect(() => {
    const conversationId = activeAgent?.conversationId;
    if (!conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setMessages([]);
    setLoading(true);
    bridge
      .invoke('conversation.messages', { conversationId })
      .then((items) => {
        if (cancelled) return;
        const loaded = normalizeMessageList(items);
        setMessages((current) => mergeLoadedMessages(conversationId, loaded, current));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    bridge
      .invoke('conversation.agentEvents', { conversationId, limit: 200 })
      .then((value) => {
        if (cancelled) return;
        const events = normalizeAgentEventList(value);
        setAgentEventsByConversation((prev) => ({
          ...prev,
          [conversationId]: events.slice(-MAX_AGENT_EVENTS_IN_MEMORY),
        }));
        const last = events.at(-1);
        setPhaseByConversation((prev) => {
          if (last) {
            return {
              ...prev,
              [conversationId]: phaseFromAgentEvent(last),
            };
          }
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setAgentEventsByConversation((prev) => {
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeAgent?.conversationId]);

  const sendTeamMessage = useCallback(
    async (payload: SendBoxPayload) => {
      const invocation = resolveTeamSendInvocation(activeTeam ?? undefined, activeAgent?.slotId, payload);
      if (!invocation) return;
      await bridge.invoke(invocation.name, invocation.params);
    },
    [activeAgent?.slotId, activeTeam]
  );

  const cancelCurrentTurn = useCallback(async () => {
    const conversationId = activeAgent?.conversationId;
    if (!conversationId) return;
    const result = await bridge.invoke('conversation.cancel', { conversationId });
    if (!result.accepted) {
      if (isRecoverableCancelError(result.error)) {
        setPhaseByConversation((prev) => ({ ...prev, [conversationId]: 'done' }));
        return;
      }
      throw new Error(result.error ?? '取消请求未被接受');
    }
    setPhaseByConversation((prev) => ({ ...prev, [conversationId]: 'done' }));
  }, [activeAgent?.conversationId]);

  const conversationId = activeAgent?.conversationId;
  return {
    messages,
    activePhase: conversationId ? phaseByConversation[conversationId] : undefined,
    agentEvents: conversationId ? agentEventsByConversation[conversationId] ?? [] : [],
    loading,
    setMessages,
    sendTeamMessage,
    cancelCurrentTurn,
    phaseByConversation,
  };
}

/** 判断取消当前回合时是否可以忽略的竞态错误。 */
function isRecoverableCancelError(error?: string): boolean {
  return error === 'runtime not found' || error === 'no active prompt';
}

/** 合并单条流式消息，保证同一会话内按序展示。 */
function mergeStreamMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const scoped = current.filter((item) => item.conversationId === incoming.conversationId);
  const index = scoped.findIndex((item) => item.id === incoming.id);
  if (index < 0) {
    return [...scoped, incoming].sort(sortMessage);
  }

  const next = [...scoped];
  next[index] = preferRicherMessage(scoped[index], incoming);
  return next.sort(sortMessage);
}

/** 将首屏加载消息与实时流消息合并，避免覆盖更完整的内容。 */
function mergeLoadedMessages(
  conversationId: string,
  loaded: ChatMessage[],
  current: ChatMessage[]
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const item of loaded.filter((message) => message.conversationId === conversationId)) {
    byId.set(item.id, item);
  }

  for (const item of current.filter((message) => message.conversationId === conversationId)) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? preferRicherMessage(existing, item) : item);
  }

  return Array.from(byId.values()).sort(sortMessage);
}

/** 在流式与持久化消息冲突时保留内容更完整的一条。 */
function preferRicherMessage(oldMessage: ChatMessage, newMessage: ChatMessage): ChatMessage {
  const mergedSequence =
    newMessage.sequence > 0 ? newMessage.sequence : oldMessage.sequence > 0 ? oldMessage.sequence : newMessage.sequence;

  if (
    oldMessage.status === 'streaming' &&
    newMessage.content.length < oldMessage.content.length
  ) {
    return { ...oldMessage, sequence: mergedSequence };
  }

  if (
    oldMessage.status === 'done' &&
    newMessage.status === 'streaming' &&
    newMessage.content.length < oldMessage.content.length
  ) {
    return { ...oldMessage, sequence: mergedSequence };
  }

  return { ...newMessage, sequence: mergedSequence };
}

/** 按服务端序列排序，序列相同再使用创建时间兜底。 */
function sortMessage(a: ChatMessage, b: ChatMessage): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  return a.createdAt - b.createdAt;
}
