import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoredAttachment } from '../../shared/types';
import { createId } from '../id';

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class AttachmentService {
  constructor(private readonly rootDir: string) {}

  async saveImage(input: { fileName: string; mimeType: string; dataBase64: string }): Promise<StoredAttachment> {
    const mimeType = input.mimeType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      throw new Error(`Unsupported image type: ${input.mimeType}`);
    }

    const base64 = stripDataUrlPrefix(input.dataBase64).trim();
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) throw new Error('Image data is empty');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10MB limit');

    const id = createId();
    const name = safeFileName(input.fileName, mimeType);
    const dir = path.join(this.rootDir, id);
    const filePath = path.join(dir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, buffer);

    return {
      id,
      kind: 'image',
      name,
      mimeType,
      size: buffer.length,
      path: filePath,
      url: `/api/attachments/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      createdAt: Date.now(),
    };
  }

  async deleteStoredFiles(attachments: StoredAttachment[]): Promise<void> {
    const root = path.resolve(this.rootDir);
    for (const attachment of attachments) {
      const filePath = path.resolve(attachment.path);
      if (!filePath.startsWith(`${root}${path.sep}`)) continue;
      await rm(path.dirname(filePath), { recursive: true, force: true });
    }
  }
}

function stripDataUrlPrefix(value: string): string {
  const match = value.match(/^data:[^;]+;base64,(.*)$/s);
  return match ? match[1] : value;
}

function safeFileName(fileName: string, mimeType: string): string {
  const fallback = `image.${extensionForMime(mimeType)}`;
  const baseName = path.basename(fileName || fallback).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  const parsed = path.parse(baseName);
  if (!parsed.name || baseName.startsWith('.')) return fallback;
  return parsed.ext ? baseName : `${baseName}.${extensionForMime(mimeType)}`;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}
