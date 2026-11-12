import {
  blacklistCreateSchema,
  blacklistUpdateSchema,
  type BlacklistEntry,
  type BlacklistInput,
  type BlacklistList,
} from "@pw/shared";
import type { Clock } from "../clock.ts";
import { AppError } from "../errors.ts";
import type { Repositories } from "../repositories/index.ts";
import { parseInput, toIso } from "./common.ts";

/** REST 와 MCP 가 함께 쓴다. 검증은 shared zod + `toDetails`, 실패는 AppError. */
export interface BlacklistService {
  list(): BlacklistList;
  /** 없는 id → NOT_FOUND */
  get(id: number): BlacklistEntry;
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

const DUPLICATE_MESSAGE = "같은 이름과 버전 범위의 항목이 이미 있습니다";

function notFound(): AppError {
  return new AppError("NOT_FOUND", "블랙리스트 항목을 찾을 수 없습니다");
}

/** 동시 요청으로 unique 제약에 걸린 경우도 DUPLICATE_ENTRY 로 바꾼다. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export function createBlacklistService(deps: BlacklistServiceDeps): BlacklistService {
  const { repos, clock } = deps;

  function mustGet(id: number): BlacklistEntry {
    const entry = repos.blacklist.get(id);
    if (!entry) throw notFound();
    return entry;
  }

  function assertUnique(input: BlacklistInput, selfId: number | null): void {
    const existing = repos.blacklist.findByKey(input.name, input.versionRange);
    if (existing && existing.id !== selfId) {
      throw new AppError("DUPLICATE_ENTRY", DUPLICATE_MESSAGE);
    }
  }

  function withDuplicateGuard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("DUPLICATE_ENTRY", DUPLICATE_MESSAGE);
      }
      throw error;
    }
  }

  return {
    list: () => ({ items: repos.blacklist.list() }),
    get: mustGet,
    create(input) {
      const data = parseInput(blacklistCreateSchema, input);
      assertUnique(data, null);
      return withDuplicateGuard(() => repos.blacklist.insert(data, toIso(clock.now())));
    },
    update(id, input) {
      // 존재 확인(404)이 본문 검증(400)보다 먼저다(S-6).
      mustGet(id);
      const data = parseInput(blacklistUpdateSchema, input);
      assertUnique(data, id);
      return withDuplicateGuard(() =>
        repos.transaction(() => {
          const entry = repos.blacklist.update(id, data, toIso(clock.now()));
          repos.findings.updateReasonForEntry(id, entry.reason);
          return entry;
        }),
      );
    },
    remove(id) {
      mustGet(id);
      repos.transaction(() => {
        repos.findings.resolveByBlacklistEntry(id, toIso(clock.now()));
        repos.blacklist.remove(id);
      });
    },
  };
}
