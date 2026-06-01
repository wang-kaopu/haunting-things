import { monotonicFactory } from 'ulid';

const monotonicUlid = monotonicFactory();

/** 生成单调递增的 ULID，作为服务端统一业务 ID。 */
export function createId(): string {
  return monotonicUlid();
}
