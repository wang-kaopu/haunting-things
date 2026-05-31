import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AgentBackend,
  AgentInfo,
  ChatMessage,
  ConversationCommands,
  ConversationUsage,
  PermissionRequest,
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
  const [usageByConversation, setUsageByConversation] = useState<Record<string, ConversationUsage>>({});
  const [commandsByConversation, setCommandsByConversation] = useState<Record<string, ConversationCommands>>({});
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
      unsubAgentStatus();
      unsubUsage();
      unsubCommands();
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
      return;
    }
    bridge
      .invoke('conversation.messages', { conversationId: agent.conversationId })
      .then(setMessages)
      .catch(() => setMessages([]));
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
  const activeCommands = activeAgent ? commandsByConversation[activeAgent.conversationId] : undefined;
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
              </div>
              <button onClick={() => void addAgent(activeTeam.id)}>Add Agent</button>
            </header>
            <MessageList messages={messages} />
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
          return (
            <button
              key={agent.slotId}
              className={`agent-tab${isActive ? ' selected' : ''}`}
              onClick={() => setActiveSlotId(agent.slotId)}
            >
              <span className="agent-name">{agent.name}</span>
              <span className={`agent-badge ${status}`}>{status}</span>
            </button>
            );
        })}

        <h3>Agent Commands</h3>
        <AgentCommandsPanel commands={activeCommands} />

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
    const team = await bridge.invoke('team.create', { name, leaderBackend: backend });
    await refresh();
    setActiveTeamId(team.id);
  }

  async function addAgent(teamId: string): Promise<void> {
    const name = window.prompt('Agent name', 'Teammate');
    if (!name) return;
    await bridge.invoke('team.addAgent', { teamId, name, backend: pickBackend() });
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
}

function MessageList({ messages }: { messages: ChatMessage[] }): React.ReactElement {
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
        <article key={message.id} className={`message ${message.role}`}>
          <small>{message.role}</small>
          <div>{message.content || (message.status === 'streaming' ? '...' : '')}</div>
        </article>
      ))}
    </div>
  );
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
