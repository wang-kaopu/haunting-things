import { useCallback, useEffect, useState } from 'react';
import type {
  Conversation,
  ConversationCommands,
  ConversationMemoryState,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '@shared/types';
import { bridge } from '@renderer/shared/bridgeClient';
import { readCachedCommands, writeCachedCommands } from '@renderer/shared/commandCache';
import { readCachedModels, writeCachedModels } from '@renderer/shared/modelCache';
import {
  normalizeConversationCommands,
  normalizeConversation,
  normalizeConversationMemory,
  normalizeConversationMemoryState,
  normalizeConversationMode,
  normalizeConversationModels,
  normalizeConversationUsage,
} from '@renderer/shared/utils/backendData';

/** 当前活跃 Agent 的运行时快照输入。 */
export type UseRuntimeSnapshotsInput = {
  activeAgent: TeamAgent | null;
};

/** 按 conversation 归档的运行时快照状态。 */
export type UseRuntimeSnapshotsResult = {
  usage?: ConversationUsage | null;
  memory?: ConversationMemoryState | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  setModel: (teamId: string, slotId: string, model: string) => Promise<void>;
  usageByConversation: Record<string, ConversationUsage>;
  memoryByConversation: Record<string, ConversationMemoryState>;
  commandsByConversation: Record<string, ConversationCommands>;
  modelsByConversation: Record<string, ConversationModels>;
  modeByConversation: Record<string, ConversationMode>;
  clearSnapshots: (conversationId: string) => void;
};

/**
 * 订阅 ACP runtime 上报的 usage、命令、模型和模式快照。
 *
 * 模型列表和可用命令会写入本地缓存，避免切换 Agent 时工具栏短暂变空。
 */
export function useRuntimeSnapshots({ activeAgent }: UseRuntimeSnapshotsInput): UseRuntimeSnapshotsResult {
  const [usageByConversation, setUsageByConversation] = useState<Record<string, ConversationUsage>>({});
  const [memoryByConversation, setMemoryByConversation] = useState<Record<string, ConversationMemoryState>>({});
  const [commandsByConversation, setCommandsByConversation] = useState<Record<string, ConversationCommands>>({});
  const [modelsByConversation, setModelsByConversation] = useState<Record<string, ConversationModels>>({});
  const [modeByConversation, setModeByConversation] = useState<Record<string, ConversationMode>>({});

  useEffect(() => {
    const unsubUsage = bridge.on('conversation.usage', (payload) => {
      const usage = normalizeConversationUsage(payload);
      if (!usage) return;
      setUsageByConversation((prev) => ({ ...prev, [usage.conversationId]: usage }));
    });
    const unsubMemory = bridge.on('conversation.memory', (payload) => {
      const memory = normalizeConversationMemoryState(payload);
      if (!memory) return;
      setMemoryByConversation((prev) => ({ ...prev, [memory.conversationId]: memory }));
    });
    const unsubCommands = bridge.on('conversation.commands', (payload) => {
      const snapshot = normalizeConversationCommands(payload);
      if (!snapshot) return;
      setCommandsByConversation((prev) => ({ ...prev, [snapshot.conversationId]: snapshot }));
      const backend = activeAgent?.conversationId === snapshot.conversationId ? activeAgent.backend : undefined;
      if (backend) writeCachedCommands(backend, snapshot);
    });
    const unsubModels = bridge.on('conversation.models', (payload) => {
      const snapshot = normalizeConversationModels(payload);
      if (!snapshot) return;
      setModelsByConversation((prev) => ({ ...prev, [snapshot.conversationId]: snapshot }));
      const backend = activeAgent?.conversationId === snapshot.conversationId ? activeAgent.backend : undefined;
      if (backend) writeCachedModels(backend, snapshot);
    });
    const unsubMode = bridge.on('conversation.mode', (payload) => {
      const snapshot = normalizeConversationMode(payload);
      if (!snapshot) return;
      setModeByConversation((prev) => ({ ...prev, [snapshot.conversationId]: snapshot }));
    });
    const unsubConversationUpdated = bridge.on('conversation.updated', (payload) => {
      const conversation = normalizeConversation(payload);
      if (!conversation) return;
      const usage = buildUsageSnapshot(conversation);
      if (usage) setUsageByConversation((prev) => ({ ...prev, [usage.conversationId]: usage }));
      const models = buildModelSnapshot(conversation);
      if (models) {
        setModelsByConversation((prev) => ({
          ...prev,
          [models.conversationId]: mergeModelSnapshot(prev[models.conversationId], models),
        }));
      }
      const mode = buildModeSnapshot(conversation);
      if (mode) setModeByConversation((prev) => ({ ...prev, [mode.conversationId]: mode }));
    });

    return () => {
      unsubUsage();
      unsubMemory();
      unsubCommands();
      unsubModels();
      unsubMode();
      unsubConversationUpdated();
    };
  }, [activeAgent?.backend, activeAgent?.conversationId]);

  useEffect(() => {
    const conversationId = activeAgent?.conversationId;
    if (!conversationId) return;

    bridge
      .invoke('conversation.get', { conversationId })
      .then((value) => {
        const conversation = normalizeConversation(value);
        if (!conversation) return;
        const usage = buildUsageSnapshot(conversation);
        if (usage) setUsageByConversation((prev) => ({ ...prev, [conversationId]: usage }));
        const models = buildModelSnapshot(conversation);
        if (models) {
          setModelsByConversation((prev) => ({
            ...prev,
            [conversationId]: mergeModelSnapshot(prev[conversationId], models),
          }));
        }
        const mode = buildModeSnapshot(conversation);
        if (mode) setModeByConversation((prev) => ({ ...prev, [conversationId]: mode }));
      })
      .catch(() => {});
    bridge
      .invoke('conversation.commands', { conversationId })
      .then((value) => {
        const snapshot = normalizeConversationCommands(value);
        if (snapshot) {
          setCommandsByConversation((prev) => ({ ...prev, [conversationId]: snapshot }));
          writeCachedCommands(activeAgent.backend, snapshot);
        } else {
          const cached = readCachedCommands(activeAgent.backend, conversationId);
          if (cached) setCommandsByConversation((prev) => ({ ...prev, [conversationId]: cached }));
        }
      })
      .catch(() => {});
    bridge
      .invoke('conversation.models', { conversationId })
      .then((value) => {
        const snapshot = normalizeConversationModels(value);
        if (snapshot) {
          setModelsByConversation((prev) => ({ ...prev, [conversationId]: snapshot }));
          writeCachedModels(activeAgent.backend, snapshot);
        } else {
          const cached = readCachedModels(activeAgent.backend, conversationId);
          if (cached) setModelsByConversation((prev) => ({ ...prev, [conversationId]: cached }));
        }
      })
      .catch(() => {});
    bridge
      .invoke('conversation.mode', { conversationId })
      .then((value) => {
        const snapshot = normalizeConversationMode(value);
        if (snapshot) setModeByConversation((prev) => ({ ...prev, [conversationId]: snapshot }));
      })
      .catch(() => {});
    bridge
      .invoke('conversation.memory', { conversationId })
      .then((value) => {
        const memory = normalizeConversationMemory(value);
        if (!memory) return;
        setMemoryByConversation((prev) => ({
          ...prev,
          [conversationId]: {
            conversationId: memory.conversationId,
            status: memory.status,
            summaryTokens: memory.tokenEstimate,
            coveredUntilSequence: memory.coveredUntilSequence,
            sourceMessageCount: memory.sourceMessageCount,
            reason: memory.compressionReason,
            error: memory.lastError,
            updatedAt: memory.updatedAt,
          },
        }));
      })
      .catch(() => {});
  }, [activeAgent?.backend, activeAgent?.conversationId]);

  const clearSnapshots = useCallback((conversationId: string) => {
    setUsageByConversation((prev) => omitKey(prev, conversationId));
    setMemoryByConversation((prev) => omitKey(prev, conversationId));
    setCommandsByConversation((prev) => omitKey(prev, conversationId));
    setModelsByConversation((prev) => omitKey(prev, conversationId));
    setModeByConversation((prev) => omitKey(prev, conversationId));
  }, []);

  const setModel = useCallback(
    async (teamId: string, slotId: string, model: string) => {
      const nextModel = model.trim();
      if (!nextModel) return;
      await bridge.invoke('team.setAgentModel', { teamId, slotId, model: nextModel });
      if (activeAgent?.conversationId) clearSnapshots(activeAgent.conversationId);
    },
    [activeAgent?.conversationId, clearSnapshots]
  );

  const conversationId = activeAgent?.conversationId;
  return {
    usage: conversationId ? usageByConversation[conversationId] : undefined,
    memory: conversationId ? memoryByConversation[conversationId] : undefined,
    commands: conversationId ? commandsByConversation[conversationId] : undefined,
    models: conversationId ? modelsByConversation[conversationId] : undefined,
    mode: conversationId ? modeByConversation[conversationId] : undefined,
    setModel,
    usageByConversation,
    memoryByConversation,
    commandsByConversation,
    modelsByConversation,
    modeByConversation,
    clearSnapshots,
  };
}

/**
 * 从 conversation 快照映射中移除指定项。
 */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * 将持久化 Conversation 字段转换为前端 usage 快照。
 */
function buildUsageSnapshot(conversation: Conversation): ConversationUsage | null {
  if (
    conversation.usageSize === undefined ||
    conversation.usageUsed === undefined ||
    conversation.usageRatio === undefined ||
    conversation.usageUpdatedAt === undefined
  ) {
    return null;
  }

  return {
    conversationId: conversation.id,
    size: conversation.usageSize,
    used: conversation.usageUsed,
    ratio: conversation.usageRatio,
    updatedAt: conversation.usageUpdatedAt,
  };
}

/**
 * 将持久化 Conversation 字段转换为最小模型快照。
 */
function buildModelSnapshot(conversation: Conversation): ConversationModels | null {
  if (!conversation.currentModelId) return null;
  return {
    conversationId: conversation.id,
    currentModelId: conversation.currentModelId,
    models: [],
    updatedAt: conversation.updatedAt,
  };
}

/**
 * 将持久化 Conversation 字段转换为模式快照。
 */
function buildModeSnapshot(conversation: Conversation): ConversationMode | null {
  if (!conversation.sessionMode) return null;
  return {
    conversationId: conversation.id,
    mode: conversation.sessionMode,
    updatedAt: conversation.updatedAt,
  };
}

/**
 * 保留已加载的模型列表，只用持久化快照补当前模型。
 */
function mergeModelSnapshot(
  current: ConversationModels | undefined,
  persisted: ConversationModels
): ConversationModels {
  if (!current) return persisted;
  return {
    ...current,
    currentModelId: persisted.currentModelId,
    updatedAt: Math.max(current.updatedAt, persisted.updatedAt),
  };
}
