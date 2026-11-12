import {
  kstDateOf,
  normalizeEntryName,
  toDetails,
  validateEntryFields,
  blacklistCreateSchema,
  blacklistQuerySchema,
  blacklistUpdateSchema,
  bulkInputSchema,
  ecosystemSchema,
  exportQuerySchema,
  importInputSchema,
  type BlacklistCreateData,
  type BlacklistEntry,
  type BlacklistList,
  type BulkResult,
  type ImportError,
  type ImportResult,
} from "@pw/shared";
import type { Clock } from "../clock.ts";
import { AppError } from "../errors.ts";
import type { BlacklistWrite } from "../repositories/blacklist.ts";
import type { Repositories } from "../repositories/index.ts";
import { parseImportContent, serializeExport } from "./blacklistFile.ts";
import { parseInput, toIso } from "./common.ts";
import { isEntryActive, isExpired, todayKst } from "./entryActivity.ts";

/** REST 와 MCP 가 함께 쓴다. 검증은 shared zod + `toDetails`, 실패는 AppError. */
export interface BlacklistService {
  /** `blacklistQuerySchema`(ecosystem, enabled, q, status)로 검증한 뒤 목록. 생략하면 전체 */
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
  /**
   * `bulkInputSchema`(ids 는 중복 제거). 없는 id 가 1개라도 있으면 NOT_FOUND 이고 아무것도 바꾸지 않는다.
   * 트랜잭션 1개. enable·disable 은 값이 이미 같은 항목을 건드리지 않는다(`updatedAt` 유지). `count` = 요청한 id 의 수.
   */
  bulk(input: unknown): BulkResult;
  /**
   * `importInputSchema`(dryRun 기본 true). 파일 수준의 오류 → VALIDATION_ERROR, 행의 오류 → `errors`.
   * 오류가 1건이라도 있거나 dryRun 이면 저장하지 않는다. 적용은 트랜잭션 1개.
   */
  importEntries(input: unknown): ImportResult;
  /** `exportQuerySchema`(format 필수 + 목록의 필터). name → id 순서 */
  exportEntries(query: unknown): ExportFile;
}

export interface ExportFile {
  content: string;
  contentType: string;
  /** `blacklist-YYYYMMDD.json|csv` (KST 날짜) */
  filename: string;
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
  function expiresAtProblem(
    value: BlacklistWrite,
    stored: string | null | undefined,
    today: string,
  ): string | null {
    if (value.expiresAt === null || value.expiresAt === stored) return null;
    return isExpired(value.expiresAt, today) ? "만료일은 오늘(KST) 이후여야 합니다" : null;
  }

  function assertExpiresAt(value: BlacklistWrite, stored: string | null | undefined, today: string): void {
    const problem = expiresAtProblem(value, stored, today);
    if (problem !== null) {
      throw new AppError("VALIDATION_ERROR", "입력값이 올바르지 않습니다 (expiresAt)", { expiresAt: problem });
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

  /**
   * parse → 종류 변경 거부 → 저장된 종류로 이름·범위 검증과 이름 정규화 → 병합한 값 검증(과거 날짜, 중복 키).
   * 쓰기는 하지 않는다. 스키마는 본문에 ecosystem 이 없으면 종류별 검증을 못 하므로 여기서 한다.
   */
  function prepareUpdate(current: BlacklistEntry, input: unknown, today: string): BlacklistWrite {
    // 종류가 바뀌면 그 항목의 기존 검출(다른 종류의 파일)이 틀린 종류로 남는다.
    // 스키마는 본문의 종류로 이름·범위를 검증하므로, 다른 오류에 가려지지 않게 먼저 거부한다.
    const requested = (input as { ecosystem?: unknown } | null)?.ecosystem;
    if (ecosystemSchema.safeParse(requested).success && requested !== current.ecosystem) {
      throw new AppError("VALIDATION_ERROR", "입력값이 올바르지 않습니다 (ecosystem)", {
        ecosystem: "종류는 바꿀 수 없습니다. 새 항목으로 등록하십시오",
      });
    }
    const data = parseInput(blacklistUpdateSchema, input);
    const invalid = validateEntryFields(current.ecosystem, data.name, data.versionRange);
    if (Object.keys(invalid).length > 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        `입력값이 올바르지 않습니다 (${Object.keys(invalid).join(", ")})`,
        invalid,
      );
    }
    const merged: BlacklistWrite = {
      name: normalizeEntryName(current.ecosystem, data.name),
      versionRange: data.versionRange,
      reason: data.reason,
      ecosystem: current.ecosystem,
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

  const toWrite = (entry: BlacklistEntry): BlacklistWrite => ({
    ecosystem: entry.ecosystem,
    name: entry.name,
    versionRange: entry.versionRange,
    reason: entry.reason,
    severity: entry.severity,
    enabled: entry.enabled,
    expiresAt: entry.expiresAt,
  });

  const isSameContent = (entry: BlacklistEntry, data: BlacklistCreateData): boolean =>
    entry.severity === data.severity &&
    entry.reason === data.reason &&
    entry.enabled === data.enabled &&
    entry.expiresAt === data.expiresAt;

  /** 가져오기에서 적용할 작업. 검증과 분류가 끝난 뒤 한 트랜잭션에서 실행한다. */
  type ImportOp =
    | { kind: "insert"; data: BlacklistCreateData }
    | { kind: "update"; id: number; data: BlacklistCreateData };

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
        repos.transaction(() => {
          // 활성 판정의 날짜와 기록 시각을 같은 순간에서 구한다. 검증 뒤에 KST 자정을 넘기면 두 값이 갈린다.
          const now = clock.now();
          return applyUpdate(id, value, toIso(now), kstDateOf(now));
        }),
      );
    },
    remove(id) {
      mustGet(id, todayKst(clock));
      repos.transaction(() => {
        repos.findings.resolveByBlacklistEntry(id, toIso(clock.now()));
        repos.blacklist.remove(id);
      });
    },
    bulk(input) {
      const { action, ids } = parseInput(bulkInputSchema, input);
      const now = clock.now();
      const today = kstDateOf(now);
      const entries = ids.map((id) => ({ id, entry: repos.blacklist.get(id, today) }));
      const missing = entries.filter(({ entry }) => entry === null).map(({ id }) => id);
      if (missing.length > 0) {
        const shown = missing.slice(0, 10).join(", ");
        throw new AppError(
          "NOT_FOUND",
          `블랙리스트 항목을 찾을 수 없습니다 (id: ${shown}${missing.length > 10 ? " 외" : ""})`,
        );
      }
      repos.transaction(() => {
        for (const { id, entry } of entries) {
          if (entry === null) continue;
          if (action === "delete") {
            repos.findings.resolveByBlacklistEntry(id, toIso(now));
            repos.blacklist.remove(id);
            continue;
          }
          const enabled = action === "enable";
          // 값이 같으면 UPDATE 하지 않는다 — updatedAt 이 바뀌면 실행 중인 스캔이 그 항목의 결과를 버린다.
          if (entry.enabled === enabled) continue;
          applyUpdate(id, { ...toWrite(entry), enabled }, toIso(now), today);
        }
      });
      return { action, count: ids.length };
    },
    importEntries(input) {
      const { format, content, dryRun } = parseInput(importInputSchema, input);
      const rows = parseImportContent(format, content);
      const now = clock.now();
      const today = kstDateOf(now);
      const errors: ImportError[] = [];
      const ops: ImportOp[] = [];
      const seen = new Set<string>();
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const item of rows) {
        if ("error" in item) {
          errors.push({ row: item.row, ...item.error });
          continue;
        }
        // 1건 등록과 같은 검증(종류별 이름·범위 규칙, 이름 정규화, 기본값)
        const parsed = blacklistCreateSchema.safeParse(item.raw);
        if (!parsed.success) {
          const details = Object.entries(toDetails(parsed.error));
          if (details.length === 0) {
            errors.push({ row: item.row, field: null, message: "입력값이 올바르지 않습니다" });
          }
          for (const [field, message] of details) errors.push({ row: item.row, field, message });
          continue;
        }
        const data = parsed.data;
        const key = JSON.stringify([data.ecosystem, data.name, data.versionRange]);
        if (seen.has(key)) {
          errors.push({ row: item.row, field: null, message: "파일 안에서 중복된 항목입니다" });
          continue;
        }
        seen.add(key);

        const existing = repos.blacklist.findByKey(data.ecosystem, data.name, data.versionRange, today);
        const problem = expiresAtProblem(data, existing?.expiresAt, today);
        if (problem !== null) {
          errors.push({ row: item.row, field: "expiresAt", message: problem });
        } else if (existing === null) {
          created += 1;
          ops.push({ kind: "insert", data });
        } else if (isSameContent(existing, data)) {
          unchanged += 1;
        } else {
          updated += 1;
          ops.push({ kind: "update", id: existing.id, data });
        }
      }

      const applied = !dryRun && errors.length === 0;
      if (applied) {
        withDuplicateGuard(() =>
          repos.transaction(() => {
            for (const op of ops) {
              if (op.kind === "insert") repos.blacklist.insert(op.data, toIso(now), today);
              else applyUpdate(op.id, op.data, toIso(now), today);
            }
          }),
        );
      }
      return { applied, created, updated, unchanged, errors };
    },
    exportEntries(query) {
      const { format, ...filter } = parseInput(exportQuerySchema, query ?? {});
      const today = todayKst(clock);
      return {
        content: serializeExport(format, repos.blacklist.list(filter, today)),
        contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        filename: `blacklist-${today.replaceAll("-", "")}.${format}`,
      };
    },
  };
}
