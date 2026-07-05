import type React from 'react';
import { LightbulbIcon } from 'lucide-react';
import type {
  AgentTurnPhase,
  ChatMessage,
  ConversationCommands,
  ConversationMemoryState,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  Team,
  TeamAgent,
} from '@shared/types';
import { ChatHeader } from '@renderer/features/chat/components/ChatHeader';
import { ChatNotificationLayer } from '@renderer/features/chat/components/ChatNotificationLayer';
import { MessageList } from '@renderer/features/chat/components/MessageList';
import { SendBox, type SendBoxPayload } from '@renderer/features/chat/components/SendBox';
import { Button } from '@renderer/shared/components/ui/button';
import type { ChatNotification } from '@renderer/shared/types/ui';

/** 聊天主面板的运行时数据和操作回调。 */
export type ChatLayoutProps = {
  team: Team | null;
  activeAgent: TeamAgent | null;
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
  usage?: ConversationUsage | null;
  memory?: ConversationMemoryState | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  chatNotifications?: ChatNotification[];
  onOpenSidebar?: () => void;
  onDismissChatNotification?: (id: string) => void;
  onOpenChatNotification?: (item: ChatNotification) => void;
  onSendMessage: (payload: SendBoxPayload) => Promise<void>;
  onCancelTurn: () => Promise<void>;
  onSetModel: (model: string) => Promise<void>;
  onSetMode: (mode: string) => Promise<void>;
  onCompressMemory: () => Promise<void>;
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
  memory,
  commands,
  models,
  mode,
  chatNotifications = [],
  onOpenSidebar,
  onDismissChatNotification,
  onOpenChatNotification,
  onSendMessage,
  onCancelTurn,
  onSetModel,
  onSetMode,
  onCompressMemory,
}: ChatLayoutProps): React.ReactElement {
  if (!team) {
    return (
      <section className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-6">
        <ChatNotificationLayer
          items={chatNotifications}
          onDismiss={onDismissChatNotification ?? (() => undefined)}
          onOpenTarget={onOpenChatNotification}
        />
        <p className="max-w-md text-center text-sm text-muted-foreground">
          选择一个团队开始对话，或点击左侧 Members 区域添加成员。
        </p>
      </section>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ChatHeader
        team={team}
        activeAgent={activeAgent}
        activePhase={activePhase}
        usage={usage}
        memory={memory}
        onOpenSidebar={onOpenSidebar}
        onCompressMemory={onCompressMemory}
      />
      <ChatNotificationLayer
        items={chatNotifications}
        onDismiss={onDismissChatNotification ?? (() => undefined)}
        onOpenTarget={onOpenChatNotification}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
      </div>
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
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-8">
      <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <LightbulbIcon aria-hidden="true" className="size-5" />
      </div>
      <h1 className="mb-6 text-[28px] font-medium leading-tight tracking-normal text-foreground">
        What can I help with?
      </h1>
      <div className="grid w-full max-w-[560px] grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          'Summarize this project',
          'Generate a task plan',
          'Debug current agent',
          'Explain this codebase',
        ].map((label) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            className="h-auto justify-start rounded-lg px-4 py-3 text-left text-sm font-normal"
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
