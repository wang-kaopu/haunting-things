import theme from '@renderer/assets/icons/file-icons/jetbrains-2023-light/theme.json';

type IconDefinition = {
  iconPath: string;
};

type FileIconTheme = {
  iconDefinitions: Record<string, IconDefinition>;
  file?: string;
  folder?: string;
  rootFolder?: string;
  folderNames?: Record<string, string>;
  fileNames?: Record<string, string>;
  fileExtensions?: Record<string, string>;
};

const fileIconTheme = theme as FileIconTheme;
const iconModules = import.meta.glob<string>(
  '../../assets/icons/file-icons/jetbrains-2023-light/icons/*.svg',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);
const iconUrlByFileName = new Map(
  Object.entries(iconModules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
);

/** 文件图标解析所需的文件或目录信息。 */
export type FileIconInput = {
  name: string;
  isDirectory: boolean;
  isRoot?: boolean;
};

/**
 * 根据 VS Code JetBrains 文件图标主题解析文件或目录对应的 SVG 地址。
 *
 * @param input - 文件或目录的名称和类型
 * @returns 可直接用于 img src 的图标资源地址
 */
export function resolveFileIcon(input: FileIconInput): string {
  const definitionId = resolveDefinitionId(input);
  const iconUrl = resolveIconUrl(definitionId);

  if (iconUrl) {
    return iconUrl;
  }

  return resolveFallbackIconUrl(input.isDirectory);
}

function resolveDefinitionId({ name, isDirectory, isRoot }: FileIconInput): string {
  if (isDirectory) {
    if (isRoot && fileIconTheme.rootFolder) {
      return fileIconTheme.rootFolder;
    }

    return lookupIconId(fileIconTheme.folderNames, name) ?? fileIconTheme.folder ?? 'folder';
  }

  return (
    lookupIconId(fileIconTheme.fileNames, name) ??
    lookupExtensionIconId(name) ??
    fileIconTheme.file ??
    'file_text'
  );
}

function lookupIconId(map: Record<string, string> | undefined, name: string): string | undefined {
  if (!map) {
    return undefined;
  }

  return map[name] ?? map[name.toLowerCase()];
}

function lookupExtensionIconId(name: string): string | undefined {
  const lowerName = name.toLowerCase();
  const segments = lowerName.split('.');

  for (let index = 1; index < segments.length; index += 1) {
    const extension = segments.slice(index).join('.');
    const iconId = fileIconTheme.fileExtensions?.[extension];

    if (iconId) {
      return iconId;
    }
  }

  return undefined;
}

function resolveFallbackIconUrl(isDirectory: boolean): string {
  const fallbackId = isDirectory ? (fileIconTheme.folder ?? 'folder') : (fileIconTheme.file ?? 'file_text');

  return resolveIconUrl(fallbackId) ?? '';
}

function resolveIconUrl(definitionId: string): string | undefined {
  const iconPath = fileIconTheme.iconDefinitions[definitionId]?.iconPath;
  const iconFileName = iconPath?.split('/').pop();

  if (!iconFileName) {
    return undefined;
  }

  return iconUrlByFileName.get(iconFileName);
}
