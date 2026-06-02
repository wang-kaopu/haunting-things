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

/** 聊天主面板的运行时数据和操作回调。 */
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
  onSetMode: (mode: string) => Promise<void>;
};

/**
 * 当前 Agent 的聊天主面板。
 *
 * Header、消息列表和发送框共享同一个运行时快照，保证模型、命令和消息显示一致。
 */
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
  onSetMode,
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
        commands={commands}
        models={models}
        mode={mode}
        onSend={onSendMessage}
        onSetModel={onSetModel}
        onSetMode={onSetMode}
      />
    </section>
  );
}
