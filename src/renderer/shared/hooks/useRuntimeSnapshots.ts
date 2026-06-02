import { useCallback, useEffect, useState } from 'react';
import type {
  ConversationCommands,
  ConversationMode,
  ConversationModels,
  ConversationUsage,
  TeamAgent,
} from '../../../shared/types';
import { bridge } from '../bridgeClient';
import { readCachedModels, writeCachedModels } from '../modelCache';
import {
  normalizeConversationCommands,
  normalizeConversationMode,
  normalizeConversationModels,
  normalizeConversationUsage,
} from '../utils/backendData';

/** 当前活跃 Agent 的运行时快照输入。 */
export type UseRuntimeSnapshotsInput = {
  activeAgent: TeamAgent | null;
};

/** 按 conversation 归档的运行时快照状态。 */
export type UseRuntimeSnapshotsResult = {
  usage?: ConversationUsage | null;
  commands?: ConversationCommands | null;
  models?: ConversationModels | null;
  mode?: ConversationMode | null;
  setModel: (teamId: string, slotId: string, model: string) => Promise<void>;
  usageByConversation: Record<string, ConversationUsage>;
  commandsByConversation: Record<string, ConversationCommands>;
  modelsByConversation: Record<string, ConversationModels>;
  modeByConversation: Record<string, ConversationMode>;
  clearSnapshots: (conversationId: string) => void;
};

/**
 * 订阅 ACP runtime 上报的 usage、命令、模型和模式快照。
 *
 * 模型列表会写入本地缓存，避免切换 Agent 时工具栏短暂变空。
 */
export function useRuntimeSnapshots({ activeAgent }: UseRuntimeSnapshotsInput): UseRuntimeSnapshotsResult {
  const [usageByConversation, setUsageByConversation] = useState<Record<string, ConversationUsage>>({});
  const [commandsByConversation, setCommandsByConversation] = useState<Record<string, ConversationCommands>>({});
  const [modelsByConversation, setModelsByConversation] = useState<Record<string, ConversationModels>>({});
  const [modeByConversation, setModeByConversation] = useState<Record<string, ConversationMode>>({});

  useEffect(() => {
    const unsubUsage = bridge.on('conversation.usage', (payload) => {
      const usage = normalizeConversationUsage(payload);
      if (!usage) return;
      setUsageByConversation((prev) => ({ ...prev, [usage.conversationId]: usage }));
    });
    const unsubCommands = bridge.on('conversation.commands', (payload) => {
      const snapshot = normalizeConversationCommands(payload);
      if (!snapshot) return;
      setCommandsByConversation((prev) => ({ ...prev, [snapshot.conversationId]: snapshot }));
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

    return () => {
      unsubUsage();
      unsubCommands();
      unsubModels();
      unsubMode();
    };
  }, [activeAgent?.backend, activeAgent?.conversationId]);

  useEffect(() => {
    const conversationId = activeAgent?.conversationId;
    if (!conversationId) return;

    bridge
      .invoke('conversation.commands', { conversationId })
      .then((value) => {
        const snapshot = normalizeConversationCommands(value);
        if (snapshot) setCommandsByConversation((prev) => ({ ...prev, [conversationId]: snapshot }));
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
  }, [activeAgent?.backend, activeAgent?.conversationId]);

  const clearSnapshots = useCallback((conversationId: string) => {
    setUsageByConversation((prev) => omitKey(prev, conversationId));
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
    commands: conversationId ? commandsByConversation[conversationId] : undefined,
    models: conversationId ? modelsByConversation[conversationId] : undefined,
    mode: conversationId ? modeByConversation[conversationId] : undefined,
    setModel,
    usageByConversation,
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
