import { app, BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number.parseInt(process.env.PORT || '25808', 10);
let serverProcess: ChildProcess | null = null;
let windowRef: BrowserWindow | null = null;

async function ensureServer(): Promise<void> {
  if (await isServerReady()) return;
  serverProcess = spawn(process.execPath, ['dist-server/server/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });
  for (let i = 0; i < 30; i++) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server did not become ready');
}

async function isServerReady(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/user`);
    return res.status === 401 || res.ok;
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  await ensureServer();
  windowRef = new BrowserWindow({ width: 1280, height: 820 });
  await windowRef.loadURL(`http://127.0.0.1:${PORT}`);
});

app.on('window-all-closed', () => {
  serverProcess?.kill();
  app.quit();
});
