import type React from 'react';
import { useEffect, useState } from 'react';
import { normalizeAuthResponse, normalizeAuthUser, readJsonResponse } from '@renderer/shared/utils/backendData';
import brandLogoUrl from '@renderer/assets/icons/logo/haunting-things-logo-cropped.png';
import { Workbench } from '@renderer/app/Workbench';
import { Button } from '@renderer/shared/components/ui/button';
import { Input } from '@renderer/shared/components/ui/input';

/** 前端登录态中使用的最小用户信息。 */
type AuthUser = {
  id: string;
  username: string;
};

/** 应用入口组件预留属性。 */
export type AppProps = Record<never, never>;

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

  if (user === undefined) {
    return <div className="grid min-h-screen place-items-center">Loading...</div>;
  }
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
  const [submitting, setSubmitting] = useState(false);

  /**
   * 提交账号密码并刷新应用登录态。
   */
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center bg-[#eef2f7]">
      <form
        className="grid w-[min(380px,calc(100vw-32px))] gap-4 rounded-xl border border-border bg-card px-6 py-6 shadow-[0_12px_40px_rgb(24_32_47_/_8%)]"
        onSubmit={submit}
      >
        <div className="flex h-[80px] items-center justify-center overflow-hidden" aria-hidden="true">
          <img
            className="h-full w-full select-none object-contain object-center mix-blend-multiply"
            src={brandLogoUrl}
            alt=""
            draggable={false}
          />
        </div>
        <label className="grid gap-2 text-sm" htmlFor="login-username">
          <span className="text-xs font-medium text-muted-foreground">用户名</span>
          <Input
            id="login-username"
            value={username}
            disabled={submitting}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="login-password">
          <span className="text-xs font-medium text-muted-foreground">密码</span>
          <Input
            id="login-password"
            type="password"
            value={password}
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </label>
        {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={submitting}>
          登录 / 注册
        </Button>
      </form>
      <p className="fixed bottom-[18px] left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-xs leading-[18px] text-muted-foreground">
        未存在的用户名将自动注册
      </p>
    </main>
  );
}
