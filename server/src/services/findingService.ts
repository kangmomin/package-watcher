import {
  findingsQuerySchema,
  findingStatusInputSchema,
  type Finding,
  type Page,
  type Summary,
} from "@pw/shared";
import type { TokenSource } from "../config.ts";
import { AppError } from "../errors.ts";
import type { Repositories } from "../repositories/index.ts";
import { canScan, parseInput } from "./common.ts";

/** REST 와 MCP 가 함께 쓴다. 검증은 shared zod + `toDetails`, 실패는 AppError. */
export interface FindingService {
  /** `findingsQuerySchema` 로 검증한 뒤 목록 */
  list(query: unknown): Page<Finding>;
  /** 없는 id → NOT_FOUND */
  get(id: number): Finding;
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
  githubTokenSource: TokenSource;
}

export function createFindingService(deps: FindingServiceDeps): FindingService {
  const { repos, githubTokenSource } = deps;

  function mustGet(id: number): Finding {
    const finding = repos.findings.get(id);
    if (!finding) throw new AppError("NOT_FOUND", "검출을 찾을 수 없습니다");
    return finding;
  }

  return {
    list(query) {
      const filter = parseInput(findingsQuerySchema, query);
      return repos.findings.list(filter);
    },
    get: mustGet,
    setStatus(id, input) {
      // 존재 확인(404)이 본문 검증(400)보다 먼저다(S-6).
      const current = mustGet(id);
      const { status } = parseInput(findingStatusInputSchema, input);
      if (current.status === "resolved") {
        throw new AppError("INVALID_STATE", "resolved 검출의 상태는 바꿀 수 없습니다");
      }
      if (current.status === status) return current;
      return repos.findings.setStatus(id, status);
    },
    summary() {
      const org = repos.settings.get("org");
      return {
        openCount: repos.findings.countByStatus("open"),
        policyOpenCount: repos.findings.countPolicyByStatus("open"),
        ignoredCount: repos.findings.countByStatus("ignored"),
        lastScan: repos.scans.latest(),
        nextScanAt: canScan(org, githubTokenSource) ? repos.settings.get("next_scan_at") : null,
      };
    },
  };
}
