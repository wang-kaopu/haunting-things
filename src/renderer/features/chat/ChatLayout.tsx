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
} from '@shared/types';
import { ChatHeader } from '@renderer/features/chat/components/ChatHeader';
import { MessageList } from '@renderer/features/chat/components/MessageList';
import { SendBox, type SendBoxPayload } from '@renderer/features/chat/components/SendBox';

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
  onOpenSidebar?: () => void;
  onSendMessage: (payload: SendBoxPayload) => Promise<void>;
  onCancelTurn: () => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
};

/**
 * 新 风格聊天主面板。
 *
 * 未选择团队时展示提示，无消息时展示欢迎页，
 * 否则展示 Header、消息列表和底部输入框。
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
  onOpenSidebar,
  onSendMessage,
  onCancelTurn,
  onSetModel,
  onSetMode,
}: ChatLayoutProps): React.ReactElement {
  if (!team) {
    return (
      <section className="chat-layout empty">
        <p>选择一个团队开始对话，或点击左侧 Members 区域添加成员。</p>
      </section>
    );
  }

  return (
    <section className="chat-layout">
      <ChatHeader
        team={team}
        activeAgent={activeAgent}
        activePhase={activePhase}
        usage={usage}
        onOpenSidebar={onOpenSidebar}
      />
      {messages.length === 0 ? (
        <ChatEmpty />
      ) : (
        <MessageList
          messages={messages}
          activePhase={activePhase}
          agents={team.agents}
          activeAgent={activeAgent}
        />
      )}
      <SendBox
        disabled={!team || !activeAgent}
        activeAgent={activeAgent}
        activePhase={activePhase}
        commands={commands}
        models={models}
        mode={mode}
        onSend={onSendMessage}
        onCancel={onCancelTurn}
        onSetModel={onSetModel}
        onSetMode={onSetMode}
      />
    </section>
  );
}

/** 新 风格空状态欢迎页。 */
function ChatEmpty(): React.ReactElement {
  return (
    <div className="chat-empty">
      <h1>What can I help with?</h1>
      <div className="chat-empty__suggestions">
        <button type="button">Summarize this project</button>
        <button type="button">Generate a task plan</button>
        <button type="button">Debug current agent</button>
        <button type="button">Explain this codebase</button>
      </div>
    </div>
  );
}
