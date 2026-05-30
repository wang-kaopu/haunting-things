import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentBackend, AgentHealth, AgentInfo } from '../shared/types';

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

export function getBridgePackage(backend: AgentBackend): string {
  return BACKENDS[backend].bridgePackage;
}

export async function listAgents(): Promise<AgentInfo[]> {
  return Promise.all((Object.keys(BACKENDS) as AgentBackend[]).map(detectAgent));
}

export async function healthAgent(backend: AgentBackend): Promise<AgentHealth> {
  const info = await detectAgent(backend);
  return {
    ...info,
    ok: info.available,
    handshake: false,
  };
}

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

async function resolveCommand(command: string): Promise<string> {
  const executable = process.platform === 'win32' ? 'where' : 'which';
  const result = await execFileAsync(executable, [command], { timeout: 5000 });
  const firstLine = result.stdout.split(/\r?\n/).find(Boolean);
  if (!firstLine) throw new Error(`${command} not found`);
  return firstLine.trim();
}
