import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const args = process.argv.slice(2);
const sourceEntry = path.join(root, 'src/server/index.ts');
const distEntry = path.join(root, 'dist-server/server/index.js');
const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs');

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

function resolveMode(input) {
  if (input.includes('--prod') || input.includes('--production')) return 'production';
  if (input.includes('--dev') || input.includes('--development')) return 'development';
  if (process.env.NODE_ENV === 'production') return 'production';
  if (existsSync(sourceEntry) && existsSync(tsxCli)) return 'development';
  return 'production';
}

function resolveCommand(selectedMode) {
  if (selectedMode === 'development') {
    if (!existsSync(sourceEntry)) {
      fail(`development reset requires ${sourceEntry}`);
    }
    if (!existsSync(tsxCli)) {
      fail('development reset requires tsx. Run npm install first, or use npm run reset-password -- --prod.');
    }
    return {
      bin: process.execPath,
      args: [tsxCli, sourceEntry, '--reset-password'],
    };
  }

  if (!existsSync(distEntry)) {
    fail(`production reset requires ${distEntry}. Run npm run build first, or use npm run reset-password -- --dev.`);
  }
  return {
    bin: process.execPath,
    args: [distEntry, '--reset-password'],
  };
}

function fail(message) {
  console.error(`[reset-password] ${message}`);
  process.exit(1);
}
