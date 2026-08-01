import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stylesPath = join(projectRoot, 'src/renderer/styles.css');
const maxStylesLines = 360;
const deprecatedSelectorPrefixes = [
  'custom-select',
  'toast',
  'permission',
  'sidebar-agent',
  'sidebar-team',
  'sidebar__',
  'app-shell',
  'mobile-sidebar-backdrop',
  'menu-popover',
  'tool-popover',
  'chat-layout',
  'chat-header',
  'messages',
  'message-',
  'composer',
  'chat-empty',
  'image-picker',
  'image-attachment',
  'usage-chip',
  'phase-badge',
  'modal-',
  'team-drawer',
  'drawer-',
  'member-card',
  'agent-badge',
  'panel-dialog',
  'sidebar-section',
  'sidebar-empty',
  'workspace-switcher',
  'workspace-picker',
  'conversation-summary',
  'workspace-panel',
  'workspace-tree',
];

type ExpectedNodeVersion = {
  major: number;
  source: string;
  installHint: string;
};

type PackageManifest = {
  engines?: {
    node?: string;
  };
};

function readExpectedNodeVersion(): ExpectedNodeVersion {
  const nvmrcPath = join(projectRoot, '.nvmrc');

  if (existsSync(nvmrcPath)) {
    const version = readFileSync(nvmrcPath, 'utf8').trim().replace(/^v/, '');

    return {
      major: Number(version.split('.')[0]),
      source: `.nvmrc (${version})`,
      installHint: 'Run: nvm install && nvm use',
    };
  }

  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as PackageManifest;
  const engineRange = packageJson.engines?.node ?? '';
  const majorMatch = engineRange.match(/>=\s*(\d+)/);

  if (!majorMatch) {
    throw new Error('Unable to determine expected Node.js version from .nvmrc or package.json engines.node.');
  }

  return {
    major: Number(majorMatch[1]),
    source: `package.json engines.node (${engineRange})`,
    installHint: 'Install a Node.js runtime that satisfies package.json engines.node.',
  };
}

function checkNodeVersion(): void {
  const expected = readExpectedNodeVersion();
  const actual = process.versions.node;
  const actualMajor = Number(actual.split('.')[0]);

  if (actualMajor !== expected.major) {
    console.error(
      [
        `Node.js ${actual} does not match this project.`,
        `Expected Node ${expected.major}.x from ${expected.source}, with the same native ABI.`,
        expected.installHint,
        'Then run: npm install',
      ].join('\n')
    );
    process.exit(1);
  }
}

async function ensureBetterSqlite3(): Promise<void> {
  try {
    await import('better-sqlite3');
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hasIncompatibleBinding =
      message.includes('NODE_MODULE_VERSION') ||
      message.includes('ERR_DLOPEN_FAILED') ||
      message.includes('was compiled against a different Node.js version');

    if (!hasIncompatibleBinding) {
      throw error;
    }
  }

  console.warn('better-sqlite3 native binding does not match the active Node.js runtime; rebuilding it now.');

  const result = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkRendererCss(): void {
  const css = readFileSync(stylesPath, 'utf8');
  const deprecatedMatches = deprecatedSelectorPrefixes.filter((prefix) => {
    const pattern = new RegExp(`\\.${escapeRegExp(prefix)}(?:[\\s{_:.#>,+~\\[]|$)`);
    return pattern.test(css);
  });
  const stylesLines = css.split(/\r?\n/).length;

  if (deprecatedMatches.length === 0 && stylesLines <= maxStylesLines) {
    return;
  }

  if (deprecatedMatches.length > 0) {
    console.error(`Deprecated renderer CSS selectors found: ${deprecatedMatches.map((item) => `.${item}*`).join(', ')}`);
  }

  if (stylesLines > maxStylesLines) {
    console.error(`src/renderer/styles.css has ${stylesLines} lines; expected at most ${maxStylesLines}.`);
  }

  console.error('Move component styling to Tailwind classes or shadcn/ui components instead of global CSS.');
  process.exit(1);
}

checkNodeVersion();
await ensureBetterSqlite3();
checkRendererCss();
