import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiErrorSchema,
  blacklistEntrySchema,
  findingSchema,
  findingsPageSchema,
  scanSchema,
  scansPageSchema,
  settingsSchema,
  summarySchema,
  type ApiError,
  type BlacklistEntry,
  type ErrorCode,
  type Finding,
  type Page,
  type Scan,
  type ScanTrigger,
  type Settings,
  type Summary,
} from "@pw/shared";
import { expect } from "vitest";
import { createApp, type AppDeps, type AppInstance } from "../app.ts";
import type { InitialSettingsEnv, TokenSource } from "../config.ts";
import { FakeClock } from "./clock.ts";
import type { FakeFeedClient } from "./feed.ts";
import { FakeGitHubClient } from "./github.ts";
import { FakeLogger } from "./logger.ts";
import { FakeMailer } from "./mailer.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TestResponse {
  status: number;
  headers: Headers;
  text: string;
  /** 본문이 JSON 이 아니면 undefined */
  json: unknown;
}

export interface TestAppOptions {
  /** 시작 시각 (기본 2026-11-12T00:00:00.000Z) */
  now?: string;
  clock?: FakeClock;
  github?: FakeGitHubClient;
  mailer?: FakeMailer;
  logger?: FakeLogger;
  /** 기본 "env". "none" 이면 GitHubClient 를 주입하지 않는다 */
  tokenSource?: TokenSource;
  /** 기본 true */
  smtpConfigured?: boolean;
  /** 재시작 테스트: 앞선 앱의 dbPath 를 넘긴다 */
  dbPath?: string;
  initialSettings?: InitialSettingsEnv;
  /** 외부 목록(feed)의 가짜 클라이언트. 없으면 동기화하지 않고 feed 항목이 0건이라 스캔에 영향이 없다 */
  feedClient?: FakeFeedClient;
  /** 스캔 직전에 feed 동기화를 기다리는 최대 시간(ms) */
  feedWaitMs?: number;
  /** 기본은 재시도와 자동 이어받기를 끈다(`retryDelaysMs: []`, `autoResumeDelayMs: null`) */
  feedOptions?: AppDeps["feedOptions"];
  /** 내장 검사(policy) 항목 9개를 만든다. 기본 false (기존 테스트의 항목 수·스캔 결과가 바뀌지 않게) */
  seedPolicy?: boolean;
}

export interface TestApp {
  readonly instance: AppInstance;
  readonly clock: FakeClock;
  readonly github: FakeGitHubClient;
  readonly mailer: FakeMailer;
  readonly logger: FakeLogger;
  readonly feedClient: FakeFeedClient | null;
  readonly dbPath: string;
  /** body 가 문자열이면 그대로(깨진 JSON 검증용), 그 외는 JSON 으로 보낸다 */
  request(method: HttpMethod, path: string, body?: unknown): Promise<TestResponse>;
  raw(path: string, init: RequestInit): Promise<TestResponse>;
  close(): Promise<void>;
}

const openApps = new Set<TestApp>();
const tempDirs: string[] = [];

/** 임시 디렉터리 안의 SQLite 파일 경로. `cleanupTestApps` 가 지운다. */
export function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pw-server-test-"));
  tempDirs.push(dir);
  return join(dir, "package-watcher.db");
}

/** 가짜 GitHub·Mailer·시계·임시 SQLite 로 앱을 만든다. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const dbPath = options.dbPath ?? createTempDbPath();
  const clock = options.clock ?? new FakeClock(options.now);
  const github = options.github ?? new FakeGitHubClient();
  const mailer = options.mailer ?? new FakeMailer();
  const logger = options.logger ?? new FakeLogger();
  const tokenSource = options.tokenSource ?? "env";

  const instance = createApp({
    dbPath,
    github: tokenSource === "none" ? null : github,
    feedWaitMs: options.feedWaitMs,
    feedOptions: options.feedOptions ?? { retryDelaysMs: [], autoResumeDelayMs: null },
    feedClient: tokenSource === "none" ? null : (options.feedClient ?? null),
    githubTokenSource: tokenSource,
    mailer,
    smtpConfigured: options.smtpConfigured ?? true,
    clock,
    logger,
    initialSettings: options.initialSettings,
    seedPolicy: options.seedPolicy ?? false,
    webDistDir: null,
  });

  let closed = false;
  const raw = async (path: string, init: RequestInit): Promise<TestResponse> =>
    toTestResponse(await instance.app.request(path, init));

  const testApp: TestApp = {
    instance,
    clock,
    github,
    mailer,
    logger,
    feedClient: options.feedClient ?? null,
    dbPath,
    request: (method, path, body) =>
      raw(
        path,
        body === undefined
          ? { method }
          : {
              method,
              headers: { "content-type": "application/json" },
              body: typeof body === "string" ? body : JSON.stringify(body),
            },
      ),
    raw,
    async close() {
      if (closed) return;
      closed = true;
      openApps.delete(testApp);
      github.releaseAll();
      options.feedClient?.releaseAll();
      await instance.close();
    },
  };
  openApps.add(testApp);
  return testApp;
}

/** afterEach 용: 열린 앱을 닫고 임시 디렉터리를 지운다. */
export async function cleanupTestApps(): Promise<void> {
  for (const app of [...openApps]) {
    try {
      await app.close();
    } catch {
      // 정리 실패가 다음 정리를 막지 않게 한다
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function toTestResponse(response: Response): Promise<TestResponse> {
  const text = await response.text();
  let json: unknown;
  if (text !== "") {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { status: response.status, headers: response.headers, text, json };
}

// ---------------------------------------------------------------- 도메인 헬퍼

export const ORG = "my-org";
export const RECIPIENTS = ["a@example.com", "b@example.com"];

export interface SettingsBody {
  org: string;
  scanIntervalHours: number;
  digestTime: string;
  recipients: string[];
  /** 생략하면 저장하지 않는다(기본 7) */
  branchScanDays?: number;
}

export const DEFAULT_SETTINGS: SettingsBody = {
  org: ORG,
  scanIntervalHours: 24,
  digestTime: "09:00",
  recipients: RECIPIENTS,
};

export interface BlacklistBody {
  name: string;
  versionRange?: string | null;
  reason: string;
}

export const EVIL: BlacklistBody = { name: "evil-pkg", versionRange: null, reason: "악성 코드" };
export const LODASH: BlacklistBody = { name: "lodash", versionRange: "<4.17.21", reason: "취약점" };

export async function putSettings(
  t: TestApp,
  overrides: Partial<SettingsBody> = {},
): Promise<Settings> {
  const res = await t.request("PUT", "/api/settings", { ...DEFAULT_SETTINGS, ...overrides });
  expect(res.status, res.text).toBe(200);
  return settingsSchema.parse(res.json);
}

export async function getSettings(t: TestApp): Promise<Settings> {
  const res = await t.request("GET", "/api/settings");
  expect(res.status, res.text).toBe(200);
  return settingsSchema.parse(res.json);
}

export async function addBlacklist(t: TestApp, body: BlacklistBody): Promise<BlacklistEntry> {
  const res = await t.request("POST", "/api/blacklist", body);
  expect(res.status, res.text).toBe(201);
  return blacklistEntrySchema.parse(res.json);
}

/** 기본 limit 200 (최대값) — 테스트 데이터는 그 안에 들어간다 */
export async function listFindings(
  t: TestApp,
  query: Record<string, string> = {},
): Promise<Page<Finding>> {
  const params = new URLSearchParams({ limit: "200", ...query });
  const res = await t.request("GET", `/api/findings?${params.toString()}`);
  expect(res.status, res.text).toBe(200);
  return findingsPageSchema.parse(res.json);
}

export async function allFindings(t: TestApp): Promise<Finding[]> {
  return (await listFindings(t)).items;
}

export async function patchFinding(
  t: TestApp,
  id: number,
  status: "open" | "ignored",
): Promise<Finding> {
  const res = await t.request("PATCH", `/api/findings/${id}`, { status });
  expect(res.status, res.text).toBe(200);
  return findingSchema.parse(res.json);
}

export async function getSummary(t: TestApp): Promise<Summary> {
  const res = await t.request("GET", "/api/summary");
  expect(res.status, res.text).toBe(200);
  return summarySchema.parse(res.json);
}

export async function listScans(
  t: TestApp,
  query: Record<string, string> = {},
): Promise<Page<Scan>> {
  const qs = new URLSearchParams(query).toString();
  const res = await t.request("GET", qs ? `/api/scans?${qs}` : "/api/scans");
  expect(res.status, res.text).toBe(200);
  return scansPageSchema.parse(res.json);
}

export async function getScan(t: TestApp, id: number): Promise<Scan> {
  const res = await t.request("GET", `/api/scans/${id}`);
  expect(res.status, res.text).toBe(200);
  return scanSchema.parse(res.json);
}

/** 스캔 1회를 끝까지 실행하고(메일 발송 포함) 종료된 Scan 을 반환한다. */
export async function runScan(t: TestApp, trigger: ScanTrigger = "manual"): Promise<Scan> {
  return scanSchema.parse(await t.instance.services.scans.runScan(trigger));
}

/** 백그라운드 스캔(POST /api/scans, tick)이 끝나기를 기다린다. */
export async function waitForScans(t: TestApp): Promise<void> {
  await t.instance.services.scans.waitForIdle();
}

/** 4xx/5xx 응답이 `ApiError` 스키마이고 status·code 가 기대값인지 확인한다. */
export function expectApiError(
  res: TestResponse,
  status: number,
  code: ErrorCode,
): ApiError["error"] {
  expect(res.status, res.text).toBe(status);
  const parsed = apiErrorSchema.safeParse(res.json);
  expect(parsed.success, `ApiError 스키마가 아닙니다: ${res.text}`).toBe(true);
  if (!parsed.success) throw parsed.error;
  expect(parsed.data.error.code).toBe(code);
  return parsed.data.error;
}

export function findOne(
  items: Finding[],
  match: Partial<Pick<Finding, "repo" | "filePath" | "packageName" | "version" | "status">>,
): Finding {
  const found = items.filter((item) =>
    Object.entries(match).every(([key, value]) => item[key as keyof Finding] === value),
  );
  expect(found, `검출 1건을 찾지 못했습니다: ${JSON.stringify(match)}`).toHaveLength(1);
  const [finding] = found;
  if (!finding) throw new Error("unreachable");
  return finding;
}
