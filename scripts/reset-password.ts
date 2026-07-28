import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const args = process.argv.slice(2);
const sourceEntry = path.join(root, 'src/server/index.ts');
const distEntry = path.join(root, 'dist-server/server/index.js');
const tsxBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

type ResetMode = 'development' | 'production';

type ResetCommand = {
  bin: string;
  args: string[];
};

const mode = resolveMode(args);
const command = resolveCommand(mode);

const child = spawn(command.bin, command.args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

/**
 * 根据命令参数、运行环境和本地依赖选择密码重置模式。
 *
 * @param input - 命令行参数
 * @returns 使用源码或构建产物执行重置
 */
function resolveMode(input: string[]): ResetMode {
  if (input.includes('--prod') || input.includes('--production')) return 'production';
  if (input.includes('--dev') || input.includes('--development')) return 'development';
  if (process.env.NODE_ENV === 'production') return 'production';
  if (existsSync(sourceEntry) && existsSync(tsxBin)) return 'development';
  return 'production';
}

/**
 * 生成指定模式下执行服务端密码重置入口的命令。
 *
 * @param selectedMode - 密码重置运行模式
 * @returns 可交给子进程执行的命令及参数
 */
function resolveCommand(selectedMode: ResetMode): ResetCommand {
  if (selectedMode === 'development') {
    if (!existsSync(sourceEntry)) {
      fail(`development reset requires ${sourceEntry}`);
    }
    if (!existsSync(tsxBin)) {
      fail('development reset requires tsx. Run npm install first, or use npx tsx scripts/reset-password.ts --prod.');
    }
    return {
      bin: tsxBin,
      args: [sourceEntry, '--reset-password'],
    };
  }

  if (!existsSync(distEntry)) {
    fail(`production reset requires ${distEntry}. Run npm run build first, or use npx tsx scripts/reset-password.ts --dev.`);
  }
  return {
    bin: process.execPath,
    args: [distEntry, '--reset-password'],
  };
}

/**
 * 输出密码重置脚本错误并终止当前进程。
 *
 * @param message - 面向开发者的错误说明
 */
function fail(message: string): never {
  console.error(`[reset-password] ${message}`);
  process.exit(1);
}
