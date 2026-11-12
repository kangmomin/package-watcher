import type { BlacklistEntry, BlacklistList } from "@pw/shared";
import type { Clock } from "../clock.ts";
import { notImplemented } from "../notImplemented.ts";
import type { Repositories } from "../repositories/index.ts";

/** REST 와 MCP 가 함께 쓴다. 검증은 shared zod + `toDetails`, 실패는 AppError. */
export interface BlacklistService {
  list(): BlacklistList;
  /** `blacklistCreateSchema`. 정규화한 (name, versionRange) 중복 → DUPLICATE_ENTRY */
  create(input: unknown): BlacklistEntry;
  /**
   * `blacklistUpdateSchema` (전체 교체). 자기 자신을 뺀 중복 → DUPLICATE_ENTRY. 없는 id → NOT_FOUND.
   * 같은 트랜잭션에서 그 항목의 활성 검출 `reason` 을 갱신한다.
   */
  update(id: number, input: unknown): BlacklistEntry;
  /** 그 항목의 활성 검출을 같은 트랜잭션에서 `resolved` 로 바꾼다. 없는 id → NOT_FOUND */
  remove(id: number): void;
}

export interface BlacklistServiceDeps {
  repos: Repositories;
  clock: Clock;
}

export function createBlacklistService(deps: BlacklistServiceDeps): BlacklistService {
  return notImplemented(deps);
}
