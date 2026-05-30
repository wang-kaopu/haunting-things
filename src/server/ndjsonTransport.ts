import type { Stream } from '@agentclientprotocol/sdk';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

/**
 * 将子进程的 stdio 包装为 ACP SDK 所需的 `Stream`。
 *
 * 把 Node.js 的 `Readable`/`Writable` 转换为 Web Streams API，
 * 再委托 SDK 的 `ndJsonStream` 处理 NDJSON 分帧。
 *
 * @param child - 必须以 `stdio: 'pipe'` 模式启动的子进程
 * @throws 若子进程未以 pipe 模式启动
 */
export function ndjsonFromChildProcess(child: ChildProcess): Stream {
  if (!child.stdout || !child.stdin) {
    throw new Error('Child process must be spawned with stdio: pipe');
  }
  const rawReadable = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const rawWritable = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  return ndJsonStream(rawWritable, rawReadable);
}
