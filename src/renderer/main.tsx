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
      setError(data.error || 'Login failed');
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
        <button type="submit">Login</button>
      </form>
    </main>
  );
}

function Workbench({ user, onLogout }: { user: AuthUser; onLogout: () => void }): React.ReactElement {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [activeSlotId, setActiveSlotId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TeamMailboxEntry[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, TeamAgentStatus>>({});
  const [agentEventsByConversation, setAgentEventsByConversation] = useState<Record<string, AgentEvent[]>>({});
  const [phaseByConversation, setPhaseByConversation] = useState<Record<string, AgentTurnPhase>>({});
  const [usageByConversation, setUsageByConversation] = useState<Record<string, ConversationUsage>>({});
  const [commandsByConversation, setCommandsByConversation] = useState<Record<string, ConversationCommands>>({});
  const [modelsByConversation, setModelsByConversation] = useState<Record<string, ConversationModels>>({});
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
  const activeAgentEvents = activeAgent ? agentEventsByConversation[activeAgent.conversationId] ?? [] : [];
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
        <button onClick={() => void createTeam()}>Create Team</button>
        <div className="list">
          {teams.map((team) => (
            <div key={team.id} className="team-row">
              <button
                className={team.id === activeTeam?.id ? 'selected team-select' : 'team-select'}
                onClick={() => setActiveTeamId(team.id)}
              >
                {team.name}
              </button>
              <button className="danger team-delete" onClick={() => void deleteTeam(team.id)} title={`Delete ${team.name}`}>
                Delete
              </button>
            </div>
          ))}
        </div>
        <button className="secondary" onClick={logout}>
          Logout
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
                {activePhase && <AgentPhaseBadge phase={activePhase} />}
              </div>
              <button onClick={() => void addAgent(activeTeam.id)}>Add Agent</button>
            </header>
            <MessageList messages={messages} activePhase={activePhase} />
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
          <div className="empty">Create a team to start.</div>
        )}
      </section>

      <aside className="inspector">
        <h3>Backends</h3>
        {agents.map((agent) => (
          <div key={agent.backend} className="agent">
            <span>{agent.name}</span>
            <code>{agent.available ? 'available' : 'missing'}</code>
          </div>
        ))}

        <h3>Team Agents</h3>
        {activeTeam?.agents.map((agent) => {
          const status = agentStatuses[agent.slotId] ?? agent.status;
          const isActive = agent.slotId === activeSlotId;
          const phase = phaseByConversation[agent.conversationId];
          return (
            <button
              key={agent.slotId}
              className={`agent-tab${isActive ? ' selected' : ''}`}
              onClick={() => setActiveSlotId(agent.slotId)}
            >
              <span className="agent-name">{agent.name}</span>
              <span className="agent-meta">
                {agent.backend}
                {agent.model ? ` · ${agent.model}` : ''}
              </span>
              <span className={`agent-badge ${status}`}>{status}</span>
              {phase && phase !== 'done' ? <span className={`agent-phase ${phase}`}>{formatPhase(phase)}</span> : null}
            </button>
          );
        })}

        <section className="panel model-panel">
          <h3>Model</h3>
          <AgentModelSelect
            agent={activeAgent}
            models={activeModels}
            onChange={(model) => void setAgentModel(model)}
          />
        </section>

        <section className="panel command-panel">
          <h3>Agent Commands</h3>
          <AgentCommandsPanel commands={activeCommands} />
        </section>

        <section className="panel activity-panel">
          <h3>Agent Activity</h3>
          <AgentActivityPanel events={activeAgentEvents} />
        </section>

        <h3>Timeline</h3>
        <div className="timeline">
          {timeline.length === 0 ? (
            <p className="muted">No team messages yet.</p>
          ) : (
            timeline.map((entry) => (
              <div key={entry.message.id} className="timeline-item">
                <div className="timeline-meta">
                  <span>
                    {entry.fromAgentName} → {entry.toAgentName}
                  </span>
                  <span className={entry.processed ? 'processed' : 'pending'}>
                    {entry.processed ? 'processed' : 'pending'}
                  </span>
                </div>
                <div className="timeline-content">{entry.message.content}</div>
              </div>
            ))
          )}
        </div>

        <h3>Server</h3>
        {serverInfo?.urls.map((url) => (
          <p key={url} className="url">
            {url}
          </p>
        ))}
      </aside>
    </main>
  );

  async function createTeam(): Promise<void> {
    const name = window.prompt('Create Team', 'New Team');
    if (!name) return;
    const backend = pickBackend();
    const leaderModel = pickModel('Leader model (optional)', undefined);
    const team = await bridge.invoke('team.create', { name, leaderBackend: backend, leaderModel });
    await refresh();
    setActiveTeamId(team.id);
  }

  async function addAgent(teamId: string): Promise<void> {
    const name = window.prompt('Agent name', 'Teammate');
    if (!name) return;
    const activeAgentConversationId = activeAgent?.conversationId;
    const model = activeAgentConversationId
      ? modelsByConversation[activeAgentConversationId]?.currentModelId ?? ''
      : '';
    const agentModel = pickModel('Agent model (optional)', model || undefined);
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
            <p className="message-error">本轮回复失败，请查看右侧 Agent Activity。</p>
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
    return <p className="muted">No active agent.</p>;
  }

  const options = models?.models ?? [];
  const current = agent.model ?? models?.currentModelId ?? '';

  return (
    <div className="model-select">
      <label className="field">
        <span>Model</span>

        {options.length > 0 ? (
          <select
            value={current}
            onChange={(event) => {
              const value = event.target.value.trim();
              if (value) onChange(value);
            }}
          >
            {!current && <option value="">Default</option>}
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
              placeholder={current || 'Enter model id'}
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
        <p className="muted">No model snapshot reported yet. You can enter a model id manually.</p>
      ) : null}
    </div>
  );
}

function AgentActivityPanel({ events }: { events: AgentEvent[] }): React.ReactElement {
  const visible = events.filter((event) => event.type !== 'agent.reply.delta').slice(-30);

  if (visible.length === 0) {
    return <p className="muted">No activity yet.</p>;
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
    case 'agent.reply.delta':
      return '正在回复';
    case 'agent.reply.done':
      return '回复完成';
    case 'agent.tool.call':
      return `调用工具：${event.title || event.toolName}`;
    case 'agent.tool.result':
      return event.isError
        ? `工具返回错误：${event.toolName ?? event.toolCallId}`
        : `工具调用完成：${event.toolName ?? event.toolCallId}`;
    case 'agent.permission.request':
      return `等待授权：${event.title}`;
    case 'agent.error':
      return `返回错误：${event.message}`;
    case 'agent.done':
      return event.status === 'idle' ? '本轮完成' : `本轮结束：${event.status}`;
  }
}

function phaseFromAgentEvent(event: AgentEvent): AgentTurnPhase {
  switch (event.type) {
    case 'agent.turn.started':
    case 'agent.thinking':
      return 'thinking';
    case 'agent.reply.delta':
    case 'agent.reply.done':
      return 'replying';
    case 'agent.tool.call':
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
    return <p className="muted">No commands reported yet.</p>;
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
            <p className="muted">No input schema</p>
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
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Message the team" />
      <button type="submit">Send</button>
    </form>
  );
}

function pickBackend(): AgentBackend {
  return window.confirm('Use Codex? Cancel selects Claude.') ? 'codex' : 'claude';
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
            Confirm
          </button>
          <button className="secondary" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
