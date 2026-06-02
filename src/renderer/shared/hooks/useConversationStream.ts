import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentEvent, AgentTurnPhase, ChatMessage, Team, TeamAgent } from '../../../shared/types';
import { bridge } from '../bridgeClient';
import { resolveTeamSendInvocation } from '../../features/teams/teamViewModel';
import type { SendBoxPayload } from '../../features/chat/components/SendBox';
import { normalizeAgentEvent, normalizeAgentEventList, normalizeConversationStream, normalizeMessageList } from '../utils/backendData';
import { phaseFromAgentEvent } from '../utils/format';

export type UseConversationStreamInput = {
  activeTeam: Team | null;
  activeAgent: TeamAgent | null;
};

export type UseConversationStreamResult = {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  agentEvents: AgentEvent[];
  loading: boolean;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  sendTeamMessage: (payload: SendBoxPayload) => Promise<void>;
  phaseByConversation: Record<string, AgentTurnPhase>;
};

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
      setMessages((current) => {
        const index = current.findIndex((item) => item.id === event.message.id);
        if (index < 0) return [...current, event.message];
        const next = [...current];
        next[index] = event.message;
        return next;
      });
    });

    const unsubAgentEvent = bridge.on('conversation.agentEvent', (payload) => {
      const event = normalizeAgentEvent(payload);
      if (!event) return;
      setAgentEventsByConversation((prev) => {
        const list = prev[event.conversationId] ?? [];
        return {
          ...prev,
          [event.conversationId]: [...list, event].slice(-80),
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
    setLoading(true);
    bridge
      .invoke('conversation.messages', { conversationId })
      .then((items) => {
        if (!cancelled) setMessages(normalizeMessageList(items));
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
          [conversationId]: events,
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

  const conversationId = activeAgent?.conversationId;
  return {
    messages,
    activePhase: conversationId ? phaseByConversation[conversationId] : undefined,
    agentEvents: conversationId ? agentEventsByConversation[conversationId] ?? [] : [],
    loading,
    setMessages,
    sendTeamMessage,
    phaseByConversation,
  };
}
