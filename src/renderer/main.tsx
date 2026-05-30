import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentBackend, AgentInfo, ChatMessage, Conversation, PermissionRequest, ServerInfo, Team } from '../shared/types';
import { bridge } from './bridgeClient';
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);

  const activeTeam = useMemo(() => teams.find((team) => team.id === activeTeamId) ?? teams[0], [teams, activeTeamId]);

  async function refresh(): Promise<void> {
    const [agentList, teamList, info] = await Promise.all([
      bridge.invoke('agent.list', undefined),
      bridge.invoke('team.list', undefined),
      bridge.invoke('server.info', undefined),
    ]);
    setAgents(agentList);
    setTeams(teamList);
    setServerInfo(info);
    if (!activeTeamId && teamList[0]) setActiveTeamId(teamList[0].id);
  }

  useEffect(() => {
    void refresh();
    const unsubStream = bridge.on('conversation.stream', ({ message }) => {
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
    return () => {
      unsubStream();
      unsubPermission();
    };
  }, []);

  useEffect(() => {
    const leader = activeTeam?.agents.find((agent) => agent.role === 'leader');
    if (!leader) {
      setMessages([]);
      return;
    }
    bridge.invoke('conversation.messages', { conversationId: leader.conversationId }).then(setMessages).catch(() => setMessages([]));
  }, [activeTeam?.id]);

  async function logout(): Promise<void> {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  }

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <strong>Haunting Souls</strong>
          <span>{user.username}</span>
        </div>
        <button onClick={() => void createTeam()}>New Team</button>
        <div className="list">
          {teams.map((team) => (
            <button
              key={team.id}
              className={team.id === activeTeam?.id ? 'selected' : ''}
              onClick={() => setActiveTeamId(team.id)}
            >
              {team.name}
            </button>
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
                <p>{activeTeam.workspace}</p>
              </div>
              <button onClick={() => void addAgent(activeTeam.id)}>Add Agent</button>
            </header>
            <MessageList messages={messages} />
            <SendBox onSend={(content) => bridge.invoke('team.sendMessage', { teamId: activeTeam.id, content })} />
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
        <h3>Agents</h3>
        {agents.map((agent) => (
          <div key={agent.backend} className="agent">
            <span>{agent.name}</span>
            <code>{agent.available ? 'available' : 'missing'}</code>
          </div>
        ))}
        <h3>Team</h3>
        {activeTeam?.agents.map((agent) => (
          <div key={agent.slotId} className="agent">
            <span>{agent.name}</span>
            <code>{agent.backend}</code>
          </div>
        ))}
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
    const name = window.prompt('Team name', 'New Team');
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
}

function MessageList({ messages }: { messages: ChatMessage[] }): React.ReactElement {
  return (
    <div className="messages">
      {messages.map((message) => (
        <article key={message.id} className={`message ${message.role}`}>
          <small>{message.role}</small>
          <div>{message.content || (message.status === 'streaming' ? '...' : '')}</div>
        </article>
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
