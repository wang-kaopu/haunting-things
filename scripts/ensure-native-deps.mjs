import { spawnSync } from 'node:child_process';

async function isBetterSqlite3Usable() {
  try {
    await import('better-sqlite3');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('NODE_MODULE_VERSION') ||
      message.includes('ERR_DLOPEN_FAILED') ||
      message.includes('was compiled against a different Node.js version')
    ) {
      return false;
    }
    throw error;
  }
}

if (await isBetterSqlite3Usable()) {
  process.exit(0);
}

console.warn('better-sqlite3 native binding does not match the active Node.js runtime; rebuilding it now.');

const result = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
