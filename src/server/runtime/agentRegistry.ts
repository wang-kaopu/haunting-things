import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentBackend, AgentHealth, AgentInfo } from '../../shared/types';

const execFileAsync = promisify(execFile);

const BACKENDS: Record<AgentBackend, { name: string; command: string; versionArgs: string[]; bridgePackage: string }> = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    versionArgs: ['--version'],
    bridgePackage: '@agentclientprotocol/claude-agent-acp',
  },
  codex: {
    name: 'Codex',
    command: 'codex',
    versionArgs: ['--version'],
    bridgePackage: '@zed-industries/codex-acp',
  },
};

/** 返回指定 Agent 后端对应的 ACP bridge package。 */
export function getBridgePackage(backend: AgentBackend): string {
  return BACKENDS[backend].bridgePackage;
}

/** 锁定版本的 bridge package，与 AionUi 保持一致，避免启动时版本漂移。 */
const BRIDGE_VERSIONS: Record<AgentBackend, string> = {
  claude: '0.29.2',
  codex: '0.9.5',
};

/** 返回带版本锁的 bridge package 名，用于 `npx -y <pkg>` 启动。 */
export function getBridgePackageVersioned(backend: AgentBackend): string {
  return `${BACKENDS[backend].bridgePackage}@${BRIDGE_VERSIONS[backend]}`;
}

/** 检测所有支持的本地 Agent CLI，并返回可用性元数据。 */
export async function listAgents(): Promise<AgentInfo[]> {
  return Promise.all((Object.keys(BACKENDS) as AgentBackend[]).map(detectAgent));
}

/** 在不启动运行时会话的前提下，返回指定后端的轻量健康检查结果。 */
export async function healthAgent(backend: AgentBackend): Promise<AgentHealth> {
  const info = await detectAgent(backend);
  return {
    ...info,
    ok: info.available,
    handshake: false,
  };
}

/** 解析指定后端 CLI，并尽量读取其版本号。 */
async function detectAgent(backend: AgentBackend): Promise<AgentInfo> {
  const config = BACKENDS[backend];
  try {
    const cliPath = await resolveCommand(config.command);
    let version: string | undefined;
    try {
      const result = await execFileAsync(config.command, config.versionArgs, { timeout: 5000 });
      version = (result.stdout || result.stderr).trim();
    } catch {
      version = undefined;
    }
    return { backend, name: config.name, available: true, cliPath, version };
  } catch (error) {
    return {
      backend,
      name: config.name,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 使用平台原生命令在 PATH 中定位可执行文件。 */
async function resolveCommand(command: string): Promise<string> {
  const executable = process.platform === 'win32' ? 'where' : 'which';
  const result = await execFileAsync(executable, [command], { timeout: 5000 });
  const firstLine = result.stdout.split(/\r?\n/).find(Boolean);
  if (!firstLine) throw new Error(`${command} not found`);
  return firstLine.trim();
}
