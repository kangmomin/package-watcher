import {
  blacklistEntrySchema,
  blacklistListSchema,
  scanSchema,
  settingsSchema,
  type BlacklistEntry,
  type Scan,
  type Settings,
} from "@pw/shared";
import Database from "better-sqlite3";
import { expect } from "vitest";
import { openDatabase, type Db } from "../db/index.ts";
import {
  DEFAULT_SETTINGS,
  getScan,
  waitForScans,
  type BlacklistBody,
  type SettingsBody,
  type TestApp,
} from "./testApp.ts";

/** 묶음 1/3 의 새 필드를 포함한 블랙리스트 본문. 잘못된 값도 보낼 수 있게 값 타입은 넓게 둔다. */
export interface EntryBody extends BlacklistBody {
  ecosystem?: string;
  severity?: string;
  enabled?: boolean;
  expiresAt?: string | null;
}

export async function addEntry(t: TestApp, body: EntryBody): Promise<BlacklistEntry> {
  const res = await t.request("POST", "/api/blacklist", body);
  expect(res.status, res.text).toBe(201);
  return blacklistEntrySchema.parse(res.json);
}

/** PUT 은 name·versionRange·reason 3개 키가 필수다(v1 과 같음). */
export async function putEntry(
  t: TestApp,
  id: number,
  body: EntryBody & { versionRange: string | null },
): Promise<BlacklistEntry> {
  const res = await t.request("PUT", `/api/blacklist/${id}`, body);
  expect(res.status, res.text).toBe(200);
  return blacklistEntrySchema.parse(res.json);
}

export async function listEntries(
  t: TestApp,
  query: Record<string, string> = {},
): Promise<BlacklistEntry[]> {
  const qs = new URLSearchParams(query).toString();
  const res = await t.request("GET", qs ? `/api/blacklist?${qs}` : "/api/blacklist");
  expect(res.status, res.text).toBe(200);
  return blacklistListSchema.parse(res.json).items;
}

export async function getEntry(t: TestApp, id: number): Promise<BlacklistEntry> {
  const found = (await listEntries(t)).find((entry) => entry.id === id);
  if (!found) throw new Error(`블랙리스트 항목이 없습니다: ${id}`);
  return found;
}

export async function putSettingsV2(
  t: TestApp,
  overrides: Partial<SettingsBody> & { notifyMinSeverity?: string } = {},
): Promise<Settings> {
  const res = await t.request("PUT", "/api/settings", { ...DEFAULT_SETTINGS, ...overrides });
  expect(res.status, res.text).toBe(200);
  return settingsSchema.parse(res.json);
}

/** POST /api/scans 로 시작하고 `getTree(repo)` 에서 멈춘 상태를 만든다. */
export async function startPausedScan(
  t: TestApp,
  repo: string,
): Promise<{ running: Scan; finish(): Promise<Scan> }> {
  const gate = t.github.pause("getTree", repo);
  const res = await t.request("POST", "/api/scans");
  expect(res.status, res.text).toBe(202);
  const running = scanSchema.parse(res.json);
  await gate.waitReached();
  return {
    running,
    async finish() {
      gate.release();
      await waitForScans(t);
      return getScan(t, running.id);
    },
  };
}

// ---------------------------------------------------------------- DB 직접 확인

export interface OpenedDatabase {
  db: Db;
  /** 마이그레이션 전의 `user_version`. 마이그레이션이 없었으면 null. v1 형태의 반환값이면 undefined */
  migratedFrom: number | null | undefined;
  /** 자동 백업 파일 경로. 백업이 없었으면 null. v1 형태의 반환값이면 undefined */
  backupPath: string | null | undefined;
}

/**
 * `openDatabase` 의 반환값을 한 모양으로 맞춘다.
 * 계약(v2)은 `{ db, migratedFrom, backupPath }` 이고 v1 은 `Database` 인스턴스를 그대로 반환한다.
 */
export function openDatabaseForTest(path: string): OpenedDatabase {
  const result: unknown = openDatabase(path);
  if (result instanceof Database) return { db: result, migratedFrom: undefined, backupPath: undefined };
  return result as OpenedDatabase;
}

export function userVersionOf(db: Db): number {
  return Number(db.pragma("user_version", { simple: true }));
}

export function columnsOf(db: Db, table: string): string[] {
  return db
    .prepare<[string], { name: string }>("SELECT name FROM pragma_table_info(?)")
    .all(table)
    .map((column) => column.name);
}

export type TableName = "blacklist_entries" | "findings" | "scans" | "settings";

export function countRows(db: Db, table: TableName): number {
  return db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0;
}

/**
 * API 로는 만들 수 없는 항목(지원하지 않는 종류 등)을 v2 스키마의 컬럼으로 직접 넣는다.
 * 생략한 컬럼은 DB 기본값(`medium`, `enabled = 1`, `expires_at = NULL`)이다.
 */
export function insertEntryRow(
  t: TestApp,
  row: { ecosystem: string; name: string; versionRange?: string | null; reason?: string },
): number {
  const now = t.clock.iso();
  const result = t.instance.db
    .prepare(
      `INSERT INTO blacklist_entries (ecosystem, name, version_range, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.ecosystem, row.name, row.versionRange ?? "", row.reason ?? "직접 넣은 항목", now, now);
  return Number(result.lastInsertRowid);
}
