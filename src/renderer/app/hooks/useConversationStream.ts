import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentEvent, AgentTurnPhase, ChatMessage, Team, TeamAgent } from '../../../shared/types';
import { bridge } from '../../bridgeClient';
import { resolveTeamSendInvocation } from '../../teamViewModel';
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
  sendTeamMessage: (content: string) => Promise<void>;
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
    const unsubStream = bridge.on('conversation.stream', ({ conversationId, message }) => {
      if (conversationId !== activeConversationRef.current) return;
      setMessages((current) => {
        const index = current.findIndex((item) => item.id === message.id);
        if (index < 0) return [...current, message];
        const next = [...current];
        next[index] = message;
        return next;
      });
    });

    const unsubAgentEvent = bridge.on('conversation.agentEvent', (event) => {
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
        if (!cancelled) setMessages(items);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    bridge
      .invoke('conversation.agentEvents', { conversationId })
      .then((events) => {
        if (cancelled) return;
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
    async (content: string) => {
      const invocation = resolveTeamSendInvocation(activeTeam ?? undefined, activeAgent?.slotId, content);
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
