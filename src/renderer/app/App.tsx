import type React from 'react';
import { useEffect, useState } from 'react';
import { normalizeAuthResponse, normalizeAuthUser, readJsonResponse } from '@renderer/shared/utils/backendData';
import { Workbench } from '@renderer/app/Workbench';

type AuthUser = {
  id: string;
  username: string;
};

export type AppProps = {};

/**
 * 应用入口组件。
 *
 * 启动时先确认登录态，未登录展示登录页，已登录进入主工作台。
 */
export function App(_props: AppProps): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/auth/user', { credentials: 'include' })
      .then((res) => (res.ok ? readJsonResponse(res) : null))
      .then((data) => {
        const nextUser = normalizeAuthResponse(data).user;
        console.info('[diag] auth:user done', {
          authenticated: Boolean(nextUser),
          userId: nextUser?.id,
          at: new Date().toISOString(),
        });
        setUser(nextUser);
      })
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="center">Loading...</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Workbench user={user} onLogout={() => setUser(null)} />;
}

/**
 * 本地管理员登录表单。
 */
function Login({ onLogin }: { onLogin: (user: AuthUser) => void }): React.ReactElement {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  /**
   * 提交账号密码并刷新应用登录态。
   */
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
        <h1>Haunting Things</h1>
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
