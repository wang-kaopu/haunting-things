import { spawn, type ChildProcess } from 'node:child_process';

type ProcessName = 'renderer' | 'server';

let stopping = false;
const processes: Array<{ name: ProcessName; child: ChildProcess }> = [];

/** 启动开发子进程，并在其异常退出时终止其余开发服务。 */
function start(name: ProcessName, command: string, args: string[]): void {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const child = spawn(executable, args, { stdio: 'inherit' });
  processes.push({ name, child });

  child.once('error', (error) => {
    console.error(`${name} failed to start:`, error);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} exited unexpectedly${signal ? ` from ${signal}` : ` with code ${code ?? 1}`}.`);
    stop(code ?? 1);
  });
}

/** 终止全部开发子进程，并保留最先触发的退出码。 */
function stop(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const { child } of processes) child.kill('SIGTERM');
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

start('renderer', 'vite', ['--config', 'vite.renderer.config.ts']);
start('server', 'tsx', ['watch', 'src/server/index.ts']);
