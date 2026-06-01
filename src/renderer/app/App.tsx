import { useEffect, useState } from 'react';
import type React from 'react';
import { normalizeAuthResponse, normalizeAuthUser, readJsonResponse } from './utils/backendData';
import { Workbench } from './Workbench';

type AuthUser = {
  id: string;
  username: string;
};

export type AppProps = {};

export function App(_props: AppProps): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/auth/user', { credentials: 'include' })
      .then((res) => (res.ok ? readJsonResponse(res) : null))
      .then((data) => setUser(normalizeAuthResponse(data).user))
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
    const data = normalizeAuthResponse(await readJsonResponse(res));
    if (!res.ok) {
      setError(data.error || '登录失败');
      return;
    }
    const user = normalizeAuthUser(data.user);
    if (!user) {
      setError('登录响应格式无效');
      return;
    }
    onLogin(user);
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
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">登录</button>
      </form>
    </main>
  );
}
