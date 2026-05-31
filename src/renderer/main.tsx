import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AgentBackend,
  AgentEvent,
  AgentInfo,
  AgentTurnPhase,
  ChatMessage,
  ConversationCommands,
  ConversationModels,
  ConversationMode,
  ConversationUsage,
  PermissionRequest,
  TeamAgent,
  TeamMailboxEntry,
  ServerInfo,
  Team,
  TeamAgentStatus,
} from '../shared/types';
import { bridge } from './bridgeClient';
import { mergeTeamMailboxEntries, resolveTeamSendInvocation } from './teamViewModel';
import './styles.css';

type AuthUser = { id: string; username: string };
type InspectorTab = 'agents' | 'activity' | 'config' | 'debug';

function App(): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/auth/user', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="center">Loading...</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Workbench user={user} onLogout={() => setUser(null)} />;
}

function Login({ onLogin }: { onLogin: (user: AuthUser) => void }): React.ReactElement {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError('');
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || '登录失败');
      return;
    }
    onLogin(data.user);
  }

  return (
    <main className="login">
      <form className="panel login-panel" onSubmit={submit}>
        <h1>Haunting Souls</h1>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">登录</button>
      </form>
    </main>
  );
}

function Workbench({ user, onLogout }: { user: AuthUser; onLogout: () => void }): React.ReactElement {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [activeSlotId, setActiveSlotId] = useState<string>('');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('agents');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TeamMailboxEntry[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, TeamAgentStatus>>({});
  const [agentEventsByConversation, setAgentEventsByConversation] = useState<Record<string, AgentEvent[]>>({});
  const [phaseByConversation, setPhaseByConversation] = useState<Record<string, AgentTurnPhase>>({});
  const [usageByConversation, setUsageByConversation] = useState<Record<string, ConversationUsage>>({});
  const [commandsByConversation, setCommandsByConversation] = useState<Record<string, ConversationCommands>>({});
  const [modelsByConversation, setModelsByConversation] = useState<Record<string, ConversationModels>>({});
  const [modeByConversation, setModeByConversation] = useState<Record<string, ConversationMode>>({});
  const [promptByConversation, setPromptByConversation] = useState<Record<string, string>>({});
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);

  const activeTeam = useMemo(() => teams.find((team) => team.id === activeTeamId) ?? teams[0], [teams, activeTeamId]);

  // useRef 避免 stale closure：conversation.stream 回调需要读最新的 activeSlotId
  const activeSlotIdRef = useRef(activeSlotId);
  const activeTeamRef = useRef(activeTeam);
  useEffect(() => { activeSlotIdRef.current = activeSlotId; }, [activeSlotId]);
  useEffect(() => { activeTeamRef.current = activeTeam; }, [activeTeam]);

  async function refresh(): Promise<void> {
    const [agentList, teamList, info] = await Promise.all([
      bridge.invoke('agent.list', undefined),
      bridge.invoke('team.list', undefined),
      bridge.invoke('server.info', undefined),
    ]);
    setAgents(agentList);
    setTeams(teamList);
    setServerInfo(info);
    setActiveTeamId((current) => {
      if (current && teamList.some((team) => team.id === current)) return current;
      return teamList[0]?.id ?? '';
    });
  }

  async function loadTimeline(teamId: string): Promise<void> {
    try {
      const entries = await bridge.invoke('team.timeline', { teamId });
      setTimeline(entries);
    } catch {
      setTimeline([]);
    }
  }

  useEffect(() => {
    void refresh();

    const unsubStream = bridge.on('conversation.stream', ({ conversationId, message }) => {
      const team = activeTeamRef.current;
      const slotId = activeSlotIdRef.current;
      const activeAgent = team?.agents.find((a) => a.slotId === slotId);
      if (conversationId !== activeAgent?.conversationId) return;
      setMessages((current) => {
        const index = current.findIndex((item) => item.id === message.id);
        if (index < 0) return [...current, message];
        const next = [...current];
        next[index] = message;
        return next;
      });
    });

    const unsubPermission = bridge.on('conversation.permission', (req) => {
      setPermission(req);
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

    const unsubAgentStatus = bridge.on('team.agent.status', ({ slotId, status }) => {
      setAgentStatuses((prev) => ({ ...prev, [slotId]: status }));
    });

    const unsubUsage = bridge.on('conversation.usage', (usage) => {
      setUsageByConversation((prev) => ({
        ...prev,
        [usage.conversationId]: usage,
      }));
    });

    const unsubCommands = bridge.on('conversation.commands', (snapshot) => {
      setCommandsByConversation((prev) => ({
        ...prev,
        [snapshot.conversationId]: snapshot,
      }));
    });

    const unsubModels = bridge.on('conversation.models', (snapshot) => {
      setModelsByConversation((prev) => ({
        ...prev,
        [snapshot.conversationId]: snapshot,
      }));
    });

    const unsubMode = bridge.on('conversation.mode', (snapshot) => {
      setModeByConversation((prev) => ({
        ...prev,
        [snapshot.conversationId]: snapshot,
      }));
    });

    const unsubPrompt = bridge.on('team.agent.prompt', ({ conversationId, prompt }) => {
      setPromptByConversation((prev) => ({
        ...prev,
        [conversationId]: prompt,
      }));
    });

    const unsubAgentAdded = bridge.on('team.agent.added', () => {
      void refresh();
    });

    const unsubAgentRemoved = bridge.on('team.agent.removed', () => {
      void refresh();
    });

    const unsubTeamMessage = bridge.on('team.agent.message', ({ teamId, entry }) => {
      const team = activeTeamRef.current;
      if (team?.id !== teamId) return;
      setTimeline((current) => mergeTeamMailboxEntries(current, entry));
    });

    return () => {
      unsubStream();
      unsubPermission();
      unsubAgentEvent();
      unsubAgentStatus();
      unsubUsage();
      unsubCommands();
      unsubModels();
      unsubMode();
      unsubPrompt();
      unsubAgentAdded();
      unsubAgentRemoved();
      unsubTeamMessage();
    };
  }, []);

  // 切换 Team 时：重置 activeSlotId 为 leader，重置 agentStatuses，加载 leader 消息
  useEffect(() => {
    if (!activeTeam) {
      setMessages([]);
      setActiveSlotId('');
      return;
    }
    const leader = activeTeam.agents.find((a) => a.role === 'leader');
    const targetSlotId = leader?.slotId ?? activeTeam.agents[0]?.slotId ?? '';
    setActiveSlotId(targetSlotId);
    setAgentStatuses({});
  }, [activeTeam?.id]);

  // 切换激活 Agent 时加载其历史消息
  useEffect(() => {
    const agent = activeTeam?.agents.find((a) => a.slotId === activeSlotId);
    if (!agent) {
      setMessages([]);
      setAgentEventsByConversation((prev) => {
        const next = { ...prev };
        delete next[activeSlotId];
        return next;
      });
      setPhaseByConversation((prev) => {
        const next = { ...prev };
        delete next[activeSlotId];
        return next;
      });
      return;
    }
    bridge
      .invoke('conversation.messages', { conversationId: agent.conversationId })
      .then(setMessages)
      .catch(() => setMessages([]));
    bridge
      .invoke('conversation.agentEvents', { conversationId: agent.conversationId })
      .then((events) => {
        setAgentEventsByConversation((prev) => ({
          ...prev,
          [agent.conversationId]: events,
        }));

        const last = events.at(-1);
        if (last) {
          setPhaseByConversation((prev) => ({
            ...prev,
            [agent.conversationId]: phaseFromAgentEvent(last),
          }));
        } else {
          setPhaseByConversation((prev) => {
            const next = { ...prev };
            delete next[agent.conversationId];
            return next;
          });
        }
      })
      .catch(() => {
        setAgentEventsByConversation((prev) => {
          const next = { ...prev };
          delete next[agent.conversationId];
          return next;
        });
        setPhaseByConversation((prev) => {
          const next = { ...prev };
          delete next[agent.conversationId];
          return next;
        });
      });
    bridge
      .invoke('conversation.commands', { conversationId: agent.conversationId })
      .then((snapshot) => {
        if (!snapshot) return;
        setCommandsByConversation((prev) => ({
          ...prev,
          [agent.conversationId]: snapshot,
        }));
      })
      .catch(() => {});
    bridge
      .invoke('conversation.models', { conversationId: agent.conversationId })
      .then((snapshot) => {
        if (!snapshot) return;
        setModelsByConversation((prev) => ({
          ...prev,
          [agent.conversationId]: snapshot,
        }));
      })
      .catch(() => {});
    bridge
      .invoke('conversation.mode', { conversationId: agent.conversationId })
      .then((snapshot) => {
        if (!snapshot) return;
        setModeByConversation((prev) => ({
          ...prev,
          [agent.conversationId]: snapshot,
        }));
      })
      .catch(() => {});
  }, [activeSlotId, activeTeam?.id]);

  useEffect(() => {
    if (activeTeam?.id) void loadTimeline(activeTeam.id);
    else setTimeline([]);
  }, [activeTeam?.id]);

  async function logout(): Promise<void> {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  }

  const activeAgent = activeTeam?.agents.find((a) => a.slotId === activeSlotId);
  const activeUsage = activeAgent ? usageByConversation[activeAgent.conversationId] : undefined;
  const activePhase = activeAgent ? phaseByConversation[activeAgent.conversationId] : undefined;
  const activeCommands = activeAgent ? commandsByConversation[activeAgent.conversationId] : undefined;
  const activeModels = activeAgent ? modelsByConversation[activeAgent.conversationId] : undefined;
  const activeMode = activeAgent ? modeByConversation[activeAgent.conversationId] : undefined;
  const activeAgentEvents = activeAgent ? agentEventsByConversation[activeAgent.conversationId] ?? [] : [];
  const activePrompt = activeAgent ? promptByConversation[activeAgent.conversationId] : undefined;
  const handleTeamSend = useCallback(
    async (content: string) => {
      const invocation = resolveTeamSendInvocation(activeTeam, activeSlotId, content);
      if (!invocation) return;
      await bridge.invoke(invocation.name, invocation.params);
    },
    [activeTeam, activeSlotId]
  );

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <strong>Haunting Souls</strong>
          <span>{user.username}</span>
        </div>
        <button onClick={() => void createTeam()}>创建团队</button>
        <div className="list">
          {teams.map((team) => (
            <div key={team.id} className="team-row">
              <button
                className={team.id === activeTeam?.id ? 'selected team-select' : 'team-select'}
                onClick={() => setActiveTeamId(team.id)}
              >
                {team.name}
              </button>
              <button className="team-delete" onClick={() => void deleteTeam(team.id)} title={`删除 ${team.name}`}>
                删除
              </button>
            </div>
          ))}
        </div>
        <button className="secondary" onClick={logout}>
          退出登录
        </button>
      </aside>

      <section className="chat">
        {activeTeam ? (
          <>
            <header>
              <div>
                <h2>{activeTeam.name}</h2>
                <p className="muted">{activeAgent?.name ?? ''}</p>
                {activeUsage && <UsageBadge usage={activeUsage} />}
                <div className="status-row">
                  {activePhase && <AgentPhaseBadge phase={activePhase} />}
                  {activeMode?.mode ? <span className="mode-badge">模式：{activeMode.mode}</span> : null}
                </div>
              </div>
              <button onClick={() => void addAgent(activeTeam.id)}>添加 Agent</button>
            </header>
            <MessageList messages={messages} activePhase={activePhase} />
            <details className="prompt-preview panel">
              <summary>查看发送给 {activeAgent?.name ?? '当前 Agent'} 的完整 Prompt</summary>
              {activePrompt ? <pre>{activePrompt}</pre> : <p className="muted">当前没有可预览的 prompt。</p>}
            </details>
            <SendBox onSend={handleTeamSend} />
            {permission && (
              <PermissionDialog
                permission={permission}
                onRespond={(optionId) => {
                  void bridge.invoke('conversation.confirmPermission', {
                    conversationId: permission.conversationId,
                    callId: permission.callId,
                    optionId,
                  });
                  setPermission(null);
                }}
                onDismiss={() => setPermission(null)}
              />
            )}
          </>
        ) : (
          <div className="empty">先创建一个团队开始。</div>
        )}
      </section>

      <aside className="inspector">
        <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">
          <button className={inspectorTab === 'agents' ? 'selected inspector-tab' : 'inspector-tab'} onClick={() => setInspectorTab('agents')}>
            团队
          </button>
          <button className={inspectorTab === 'activity' ? 'selected inspector-tab' : 'inspector-tab'} onClick={() => setInspectorTab('activity')}>
            活动
          </button>
          <button className={inspectorTab === 'config' ? 'selected inspector-tab' : 'inspector-tab'} onClick={() => setInspectorTab('config')}>
            配置
          </button>
          <button className={inspectorTab === 'debug' ? 'selected inspector-tab' : 'inspector-tab'} onClick={() => setInspectorTab('debug')}>
            调试
          </button>
        </div>

        <div className="inspector-body">
          {inspectorTab === 'agents' ? (
            <>
              <section className="inspector-section">
                <h3>后端</h3>
                {agents.length === 0 ? (
                  <p className="muted">暂无后端信息。</p>
                ) : (
                  agents.map((agent) => (
                    <div key={agent.backend} className="agent">
                      <span>{agent.name}</span>
                      <code>{agent.available ? '可用' : '不可用'}</code>
                    </div>
                  ))
                )}
              </section>

              <section className="inspector-section">
                <h3>团队成员</h3>
                {activeTeam?.agents.length ? (
                  activeTeam.agents.map((agent) => {
                    const status = agentStatuses[agent.slotId] ?? agent.status;
                    const isActive = agent.slotId === activeSlotId;
                    const phase = phaseByConversation[agent.conversationId];
                    const mode = modeByConversation[agent.conversationId];
                    const commandCount = commandsByConversation[agent.conversationId]?.commands.length ?? 0;
                    return (
                      <button
                        key={agent.slotId}
                        className={`agent-tab${isActive ? ' selected' : ''}`}
                        onClick={() => setActiveSlotId(agent.slotId)}
                      >
                        <span className="agent-tab-header">
                          <span className="agent-name">{agent.name}</span>
                          <span className={`agent-badge ${status}`}>{formatTeamAgentStatus(status)}</span>
                        </span>
                        <span className="agent-meta">
                          {agent.backend}
                          {agent.model ? ` · ${agent.model}` : ''}
                          {commandCount > 0 ? ` · ${commandCount} 命令` : ''}
                        </span>
                        <span className="agent-submeta">
                          {phase && phase !== 'done' ? <span className={`agent-phase ${phase}`}>{formatPhase(phase)}</span> : null}
                          {mode?.mode ? <span className="mode-badge">模式：{mode.mode}</span> : null}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="muted">暂无团队成员。</p>
                )}
              </section>
            </>
          ) : null}

          {inspectorTab === 'activity' ? (
            <section className="inspector-section panel activity-panel">
              <h3>Agent 活动</h3>
              <AgentActivityPanel events={activeAgentEvents} />
            </section>
          ) : null}

          {inspectorTab === 'config' ? (
            <>
              <section className="inspector-section panel model-panel">
                <h3>模型</h3>
                <AgentModelSelect
                  agent={activeAgent}
                  models={activeModels}
                  onChange={(model) => void setAgentModel(model)}
                />
              </section>

              <section className="inspector-section panel command-panel">
                <h3>Agent 命令</h3>
                <AgentCommandsPanel commands={activeCommands} />
              </section>

              <section className="inspector-section panel">
                <h3>模式</h3>
                {activeMode?.mode ? <span className="mode-badge">当前：{activeMode.mode}</span> : <p className="muted">暂无模式快照。</p>}
              </section>

              <section className="inspector-section panel">
                <h3>Usage</h3>
                {activeUsage ? <UsageBadge usage={activeUsage} /> : <p className="muted">暂无 usage。</p>}
              </section>
            </>
          ) : null}

          {inspectorTab === 'debug' ? (
            <>
              <section className="inspector-section">
                <h3>时间线</h3>
                <div className="timeline">
                  {timeline.length === 0 ? (
                    <p className="muted">暂无团队消息。</p>
                  ) : (
                    timeline.map((entry) => (
                      <div key={entry.message.id} className="timeline-item">
                        <div className="timeline-meta">
                          <span>
                            {entry.fromAgentName} → {entry.toAgentName}
                          </span>
                          <span className={entry.processed ? 'processed' : 'pending'}>
                            {entry.processed ? '已处理' : '待处理'}
                          </span>
                        </div>
                        <div className="timeline-content">{entry.message.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="inspector-section">
                <h3>服务</h3>
                {serverInfo?.urls.length ? (
                  serverInfo.urls.map((url) => (
                    <p key={url} className="url">
                      {url}
                    </p>
                  ))
                ) : (
                  <p className="muted">暂无服务地址。</p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </main>
  );

  async function createTeam(): Promise<void> {
    const name = window.prompt('创建团队', 'New Team');
    if (!name) return;
    const backend = pickBackend();
    const leaderModel = pickModel('Leader 模型（可选）', undefined);
    const team = await bridge.invoke('team.create', { name, leaderBackend: backend, leaderModel });
    await refresh();
    setActiveTeamId(team.id);
  }

  async function addAgent(teamId: string): Promise<void> {
    const name = window.prompt('Agent 名称', 'Teammate');
    if (!name) return;
    const activeAgentConversationId = activeAgent?.conversationId;
    const model = activeAgentConversationId
      ? modelsByConversation[activeAgentConversationId]?.currentModelId ?? ''
      : '';
    const agentModel = pickModel('Agent 模型（可选）', model || undefined);
    await bridge.invoke('team.addAgent', { teamId, name, backend: pickBackend(), model: agentModel });
    await refresh();
  }

  async function deleteTeam(teamId: string): Promise<void> {
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    const confirmed = window.confirm(`Delete Team "${team.name}"? This will remove the workspace and all members.`);
    if (!confirmed) return;
    await bridge.invoke('team.delete', { teamId });
    await refresh();
  }

  async function setAgentModel(model: string): Promise<void> {
    const nextModel = model.trim();
    if (!activeTeam || !activeAgent || !nextModel) return;
    if (activeAgent.model === nextModel) return;
    await bridge.invoke('team.setAgentModel', {
      teamId: activeTeam.id,
      slotId: activeAgent.slotId,
      model: nextModel,
    });
    const conversationId = activeAgent.conversationId;
    setUsageByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setCommandsByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setModelsByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setModeByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setPromptByConversation((prev) => {
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    await refresh();
  }
}

function MessageList({
  messages,
  activePhase,
}: {
  messages: ChatMessage[];
  activePhase?: AgentTurnPhase;
}): React.ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, lastMessage?.content, lastMessage?.status]);

  return (
    <div className="messages" ref={listRef}>
      {messages.map((message) => (
        <article key={message.id} className={`message ${message.role} ${message.status === 'error' ? 'error' : ''}`}>
          <small>{message.role}</small>
          <div>{message.content || (message.status === 'streaming' ? phaseMessage(activePhase) : '')}</div>
          {message.status === 'error' ? (
            <p className="message-error">本轮回复失败，请查看右侧活动面板。</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function phaseMessage(phase?: AgentTurnPhase): string {
  switch (phase) {
    case 'thinking':
      return '正在思考...';
    case 'planning':
      return '正在规划...';
    case 'tool_calling':
      return '正在调用工具...';
    case 'waiting_permission':
      return '等待授权...';
    case 'failed':
      return '本轮出现错误...';
    case 'done':
    case 'queued':
    case 'replying':
    default:
      return '正在回复...';
  }
}

function UsageBadge({ usage }: { usage: ConversationUsage }): React.ReactElement {
  return (
    <div className="usage-badge" title={`Updated at ${new Date(usage.updatedAt).toLocaleTimeString()}`}>
      <span>
        {usage.used.toLocaleString()} / {usage.size.toLocaleString()}
      </span>
      <span>{Math.round(usage.ratio * 100)}%</span>
    </div>
  );
}

function AgentPhaseBadge({ phase }: { phase: AgentTurnPhase }): React.ReactElement {
  const label: Record<AgentTurnPhase, string> = {
    queued: '排队中',
    thinking: '正在思考',
    planning: '正在规划',
    replying: '正在回复',
    tool_calling: '调用工具',
    waiting_permission: '等待授权',
    failed: '返回错误',
    done: '已完成',
  };

  return <span className={`phase-badge ${phase}`}>{label[phase]}</span>;
}

function AgentModelSelect({
  agent,
  models,
  onChange,
}: {
  agent?: TeamAgent;
  models?: ConversationModels;
  onChange: (model: string) => void;
}): React.ReactElement {
  const [customModel, setCustomModel] = useState('');

  if (!agent) {
    return <p className="muted">暂无当前 Agent。</p>;
  }

  const options = models?.models ?? [];
  const current = agent.model ?? models?.currentModelId ?? '';

  return (
    <div className="model-select">
      <label className="field">
        <span>模型</span>

        {options.length > 0 ? (
          <select
            value={current}
            onChange={(event) => {
              const value = event.target.value.trim();
              if (value) onChange(value);
            }}
          >
            {!current && <option value="">默认</option>}
            {current && !options.some((model) => model.id === current) ? <option value={current}>{current}</option> : null}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name || model.id}
              </option>
            ))}
          </select>
        ) : (
          <div className="inline-form">
            <input
              value={customModel}
              placeholder={current || '输入模型 ID'}
              onChange={(event) => setCustomModel(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                const value = customModel.trim();
                if (value) onChange(value);
              }}
            >
              Apply
            </button>
          </div>
        )}
      </label>

      {options.length === 0 ? (
        <p className="muted">暂无模型快照，可手动输入模型 ID。</p>
      ) : null}
    </div>
  );
}

function AgentActivityPanel({ events }: { events: AgentEvent[] }): React.ReactElement {
  const visible = events.filter(shouldShowInActivity).slice(-30);

  if (visible.length === 0) {
    return <p className="muted">暂无活动。</p>;
  }

  return (
    <div className="activity-list">
      {visible.map((event) => (
        <div key={event.id} className={`activity-item ${event.type.replaceAll('.', '-')}`}>
          <span className="activity-time">{new Date(event.at).toLocaleTimeString()}</span>
          <span className="activity-text">{formatAgentEvent(event)}</span>
        </div>
      ))}
    </div>
  );
}

function formatAgentEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent.turn.started':
      return '开始新一轮任务';
    case 'agent.thinking':
      return '正在思考';
    case 'agent.plan':
      return event.entries.length ? `正在规划：${event.entries.join(' / ')}` : '正在规划';
    case 'agent.reply.delta':
      return '正在回复';
    case 'agent.reply.done':
      return '回复完成';
    case 'agent.tool.call':
      return `调用工具：${event.title || event.toolName || event.toolCallId}`;
    case 'agent.tool.update':
      return `工具运行中：${event.title || event.toolName || event.toolCallId}${event.status ? ` (${event.status})` : ''}`;
    case 'agent.tool.result':
      return event.isError
        ? `工具返回错误：${event.title || event.toolName || event.toolCallId}`
        : `工具调用完成：${event.title || event.toolName || event.toolCallId}`;
    case 'agent.permission.request':
      return `等待授权：${event.title}`;
    case 'agent.error':
      return `返回错误：${event.message}`;
    case 'agent.done':
      return event.status === 'idle' ? '本轮完成' : `本轮结束：${event.status}`;
  }
}

function shouldShowInActivity(event: AgentEvent): boolean {
  switch (event.type) {
    case 'agent.reply.delta':
    case 'agent.reply.done':
      return false;
    default:
      return true;
  }
}

function phaseFromAgentEvent(event: AgentEvent): AgentTurnPhase {
  switch (event.type) {
    case 'agent.turn.started':
    case 'agent.thinking':
      return 'thinking';
    case 'agent.plan':
      return 'planning';
    case 'agent.reply.delta':
    case 'agent.reply.done':
      return 'replying';
    case 'agent.tool.call':
    case 'agent.tool.update':
      return 'tool_calling';
    case 'agent.tool.result':
      return event.isError ? 'failed' : 'tool_calling';
    case 'agent.permission.request':
      return 'waiting_permission';
    case 'agent.error':
      return 'failed';
    case 'agent.done':
      return event.status === 'idle' ? 'done' : 'failed';
  }
  return 'queued';
}

function formatPhase(phase: AgentTurnPhase): string {
  const labels: Record<AgentTurnPhase, string> = {
    queued: '排队中',
    thinking: '正在思考',
    planning: '正在规划',
    replying: '正在回复',
    tool_calling: '调用工具',
    waiting_permission: '等待授权',
    failed: '返回错误',
    done: '已完成',
  };
  return labels[phase];
}

function AgentCommandsPanel({
  commands,
}: {
  commands?: ConversationCommands | null;
}): React.ReactElement {
  if (!commands || commands.commands.length === 0) {
    return <p className="muted">暂无命令快照。</p>;
  }

  return (
    <div className="command-list">
      {commands.commands.map((command) => (
        <details key={command.name} className="command-item">
          <summary>
            <code>{command.name}</code>
            {command.description && <span>{command.description}</span>}
          </summary>
          {command.input != null ? (
            <pre>{JSON.stringify(command.input, null, 2)}</pre>
          ) : (
            <p className="muted">暂无输入 schema。</p>
          )}
        </details>
      ))}
    </div>
  );
}

function pickModel(label: string, defaultValue?: string): string | undefined {
  const value = window.prompt(label, defaultValue ?? '');
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function SendBox({ onSend }: { onSend: (content: string) => Promise<unknown> }): React.ReactElement {
  const [content, setContent] = useState('');
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    setContent('');
    await onSend(trimmed);
  }
  return (
    <form className="sendbox" onSubmit={submit}>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="给团队发送消息" />
      <button type="submit">发送</button>
    </form>
  );
}

function pickBackend(): AgentBackend {
  return window.confirm('使用 Codex？取消则选择 Claude。') ? 'codex' : 'claude';
}

function PermissionDialog({
  permission,
  onRespond,
  onDismiss,
}: {
  permission: PermissionRequest;
  onRespond: (optionId: string) => void;
  onDismiss: () => void;
}): React.ReactElement {
  const [selected, setSelected] = useState(permission.options[0]?.id ?? '');
  return (
    <div className="permission-overlay">
      <div className="permission-dialog panel">
        <h3>{permission.title}</h3>
        {permission.body && <pre className="permission-body">{permission.body}</pre>}
        <div className="permission-options">
          {permission.options.map((opt) => (
            <label key={opt.id} className="permission-option">
              <input
                type="radio"
                name="permission"
                value={opt.id}
                checked={selected === opt.id}
                onChange={() => setSelected(opt.id)}
              />
              {opt.label}
              {opt.description && <span className="permission-desc"> — {opt.description}</span>}
            </label>
          ))}
        </div>
        <div className="permission-actions">
          <button onClick={() => onRespond(selected)} disabled={!selected}>
            确认
          </button>
          <button className="secondary" onClick={onDismiss}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTeamAgentStatus(status: TeamAgentStatus): string {
  const labels: Record<TeamAgentStatus, string> = {
    idle: '空闲',
    active: '运行中',
    failed: '失败',
    stopped: '已停止',
  };
  return labels[status];
}

createRoot(document.getElementById('root')!).render(<App />);
