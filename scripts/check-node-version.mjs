import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nvmrc = readFileSync(join(projectRoot, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const expectedMajor = Number(nvmrc.split('.')[0]);
const actual = process.versions.node;
const actualMajor = Number(actual.split('.')[0]);

if (actualMajor !== expectedMajor) {
  console.error(
    [
      `Node.js ${actual} does not match this project.`,
      `Expected Node.js ${nvmrc} from .nvmrc, or another Node ${expectedMajor}.x runtime with the same native ABI.`,
      'Run: nvm install && nvm use',
      'Then run: npm install',
    ].join('\n')
  );
  process.exit(1);
}
