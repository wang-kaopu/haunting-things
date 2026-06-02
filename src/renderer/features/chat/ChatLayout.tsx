import type React from 'react';
import type {
  AgentTurnPhase,
  ChatMessage,
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  Team,
  TeamAgent,
} from '../../../shared/types';
import { ChatHeader } from './components/ChatHeader';
import { MessageList } from './components/MessageList';
import { SendBox, type SendBoxPayload } from './components/SendBox';

export type ChatLayoutProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  onAddAgentClick: () => void;
  onSendMessage: (payload: SendBoxPayload) => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
};

export function ChatLayout({
  team,
  activeAgent,
  messages,
  activePhase,
  usage,
  commands,
  models,
  mode,
  onAddAgentClick,
  onSendMessage,
  onSetModel,
}: ChatLayoutProps): React.ReactElement {
  if (!team) {
    return <section className="chat-layout empty">先创建一个团队开始。</section>;
  }

  return (
    <section className="chat-layout">
      <ChatHeader
        team={team}
        activeAgent={activeAgent}
        activePhase={activePhase}
        usage={usage}
        onAddAgentClick={onAddAgentClick}
      />
      <MessageList messages={messages} activePhase={activePhase} />
      <SendBox
        disabled={!team || !activeAgent}
        activeAgent={activeAgent}
        usage={usage}
        commands={commands}
        models={models}
        mode={mode}
        onSend={onSendMessage}
        onSetModel={onSetModel}
      />
    </section>
  );
}
