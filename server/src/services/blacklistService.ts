import {
  blacklistCreateSchema,
  blacklistQuerySchema,
  blacklistUpdateSchema,
  type BlacklistEntry,
  type BlacklistList,
} from "@pw/shared";
import type { Clock } from "../clock.ts";
import { AppError } from "../errors.ts";
import type { BlacklistWrite } from "../repositories/blacklist.ts";
import type { Repositories } from "../repositories/index.ts";
import { parseInput, toIso } from "./common.ts";
import { isEntryActive, isExpired, todayKst } from "./entryActivity.ts";

/** REST 와 MCP 가 함께 쓴다. 검증은 shared zod + `toDetails`, 실패는 AppError. */
export interface BlacklistService {
  /** `blacklistQuerySchema`(ecosystem, enabled, q)로 검증한 뒤 목록. 생략하면 전체 */
  list(query?: unknown): BlacklistList;
  /** 없는 id → NOT_FOUND */
  get(id: number): BlacklistEntry;
  /** `blacklistCreateSchema`(기본값 채움). 정규화한 (ecosystem, name, versionRange) 중복 → DUPLICATE_ENTRY */
  create(input: unknown): BlacklistEntry;
  /**
   * `blacklistUpdateSchema`. name·versionRange·reason 은 전체 교체, 새 필드는 생략하면 저장된 값을 유지한다.
   * 과거 날짜와 중복 키 검사는 병합한 값으로 한다. 자기 자신을 뺀 중복 → DUPLICATE_ENTRY. 없는 id → NOT_FOUND.
   * 같은 트랜잭션에서 ① 항목 UPDATE ② 활성 검출의 사유·심각도 갱신 ③ 갱신 후 비활성이면 활성 검출을 resolved.
   */
  update(id: number, input: unknown): BlacklistEntry;
  /** 그 항목의 활성 검출을 같은 트랜잭션에서 `resolved` 로 바꾼다. 없는 id → NOT_FOUND */
  remove(id: number): void;
}

export interface BlacklistServiceDeps {
  repos: Repositories;
  clock: Clock;
}

export const DUPLICATE_MESSAGE = "같은 종류·이름·버전 범위의 항목이 이미 있습니다";

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

  function mustGet(id: number, today: string): BlacklistEntry {
    const entry = repos.blacklist.get(id, today);
    if (!entry) throw notFound();
    return entry;
  }

  /**
   * 과거 날짜 검사는 시계가 필요해서 서버가 한다. 저장된 값과 같으면 과거여도 받는다
   * (만료된 항목의 사유나 심각도만 고치는 경우).
   */
  function assertExpiresAt(value: BlacklistWrite, stored: string | null | undefined, today: string): void {
    if (value.expiresAt === null || value.expiresAt === stored) return;
    if (isExpired(value.expiresAt, today)) {
      throw new AppError("VALIDATION_ERROR", "입력값이 올바르지 않습니다 (expiresAt)", {
        expiresAt: "만료일은 오늘(KST) 이후여야 합니다",
      });
    }
  }

  function assertUnique(value: BlacklistWrite, selfId: number | null, today: string): void {
    const existing = repos.blacklist.findByKey(value.ecosystem, value.name, value.versionRange, today);
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

  /** parse → 저장값과 병합 → 병합한 값 검증(과거 날짜, 중복 키). 쓰기는 하지 않는다. */
  function prepareUpdate(current: BlacklistEntry, input: unknown, today: string): BlacklistWrite {
    const data = parseInput(blacklistUpdateSchema, input);
    const merged: BlacklistWrite = {
      name: data.name,
      versionRange: data.versionRange,
      reason: data.reason,
      ecosystem: data.ecosystem ?? current.ecosystem,
      severity: data.severity ?? current.severity,
      enabled: data.enabled ?? current.enabled,
      expiresAt: data.expiresAt === undefined ? current.expiresAt : data.expiresAt,
    };
    assertExpiresAt(merged, current.expiresAt, today);
    assertUnique(merged, current.id, today);
    return merged;
  }

  /** 트랜잭션을 열지 않는다(호출자가 연다). 순서가 계약이다 — resolved 가 된 행도 마지막 값을 갖게 한다. */
  function applyUpdate(id: number, value: BlacklistWrite, now: string, today: string): BlacklistEntry {
    const entry = repos.blacklist.update(id, value, now, today); // ①
    repos.findings.updateReasonAndSeverityForEntry(id, entry.reason, entry.severity); // ②
    if (!isEntryActive(entry, today)) repos.findings.resolveByBlacklistEntry(id, now); // ③
    return entry;
  }

  return {
    list(query) {
      const filter = parseInput(blacklistQuerySchema, query ?? {});
      return { items: repos.blacklist.list(filter, todayKst(clock)) };
    },
    get: (id) => mustGet(id, todayKst(clock)),
    create(input) {
      const today = todayKst(clock);
      const data = parseInput(blacklistCreateSchema, input);
      assertExpiresAt(data, undefined, today);
      assertUnique(data, null, today);
      return withDuplicateGuard(() => repos.blacklist.insert(data, toIso(clock.now()), today));
    },
    update(id, input) {
      const today = todayKst(clock);
      // 존재 확인(404)이 본문 검증(400)보다 먼저다(S-6).
      const current = mustGet(id, today);
      const value = prepareUpdate(current, input, today);
      return withDuplicateGuard(() =>
        repos.transaction(() => applyUpdate(id, value, toIso(clock.now()), today)),
      );
    },
    remove(id) {
      mustGet(id, todayKst(clock));
      repos.transaction(() => {
        repos.findings.resolveByBlacklistEntry(id, toIso(clock.now()));
        repos.blacklist.remove(id);
      });
    },
  };
}
