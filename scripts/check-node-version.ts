import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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

/**
 * 读取项目期望的 Node 主版本。
 *
 * @returns 期望主版本与用于错误提示的来源说明
 */
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
