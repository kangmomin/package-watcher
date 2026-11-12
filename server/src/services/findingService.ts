import type { Finding, Page, Summary } from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { TokenSource } from "../config.ts";
import { notImplemented } from "../notImplemented.ts";
import type { Repositories } from "../repositories/index.ts";

/** REST 와 MCP 가 함께 쓴다. 검증은 shared zod + `toDetails`, 실패는 AppError. */
export interface FindingService {
  /** `findingsQuerySchema` 로 검증한 뒤 목록 */
  list(query: unknown): Page<Finding>;
  /**
   * `findingStatusInputSchema` 로 검증. `resolved` 행 → INVALID_STATE, 없는 id → NOT_FOUND.
   * 같은 상태 → 변경 없이 200. `notifiedAt` 은 바꾸지 않는다.
   */
  setStatus(id: number, input: unknown): Finding;
  /** `nextScanAt` 은 org 또는 토큰이 없으면 null */
  summary(): Summary;
}

export interface FindingServiceDeps {
  repos: Repositories;
  clock: Clock;
  githubTokenSource: TokenSource;
}

export function createFindingService(deps: FindingServiceDeps): FindingService {
  return notImplemented(deps);
}
