import { readFileSync } from 'node:fs';
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

/**
 * 将 class 前缀转义成可放入正则表达式的文本。
 *
 * @param value - 待转义的 class 前缀
 * @returns 转义后的正则片段
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检查全局样式入口是否重新引入已废弃的组件级选择器。
 *
 * @returns 违规的 class 前缀集合
 */
function findDeprecatedSelectors() {
  const css = readFileSync(stylesPath, 'utf8');

  return deprecatedSelectorPrefixes.filter((prefix) => {
    const pattern = new RegExp(`\\.${escapeRegExp(prefix)}(?:[\\s{_:.#>,+~\\[]|$)`);
    return pattern.test(css);
  });
}

/**
 * 检查全局样式文件是否超过迁移期约定的规模上限。
 *
 * @returns 当前行数
 */
function countStylesLines() {
  const css = readFileSync(stylesPath, 'utf8');
  return css.split(/\r?\n/).length;
}

const deprecatedMatches = findDeprecatedSelectors();
const stylesLines = countStylesLines();

if (deprecatedMatches.length > 0 || stylesLines > maxStylesLines) {
  if (deprecatedMatches.length > 0) {
    console.error(`Deprecated renderer CSS selectors found: ${deprecatedMatches.map((item) => `.${item}*`).join(', ')}`);
  }

  if (stylesLines > maxStylesLines) {
    console.error(`src/renderer/styles.css has ${stylesLines} lines; expected at most ${maxStylesLines}.`);
  }

  console.error('Move component styling to Tailwind classes or shadcn/ui components instead of global CSS.');
  process.exit(1);
}
