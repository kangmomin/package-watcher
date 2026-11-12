import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  digestTimeSchema,
  orgSchema,
  recipientsSchema,
  scanIntervalHoursSchema,
} from "@pw/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { Clock } from "./clock.ts";
import type { InitialSettingsEnv, TokenSource } from "./config.ts";
import { openDatabase, type Db } from "./db/index.ts";
import { AppError } from "./errors.ts";
import type { GitHubClient } from "./github/client.ts";
import { consoleLogger, type Logger } from "./logger.ts";
import { createMcpRoutes } from "./mcp/server.ts";
import { createRepositories, type Repositories } from "./repositories/index.ts";
import type { SettingKey } from "./repositories/settings.ts";
import { createBlacklistRoutes } from "./routes/blacklist.ts";
import { toErrorResponse } from "./routes/errors.ts";
import { createFindingRoutes } from "./routes/findings.ts";
import { createScanRoutes } from "./routes/scans.ts";
import { createSettingsRoutes } from "./routes/settings.ts";
import { createScheduler, FIRST_SCAN_DELAY_MS, type Scheduler } from "./scheduler.ts";
import { createBlacklistService } from "./services/blacklistService.ts";
import { addMs, canScan, toIso } from "./services/common.ts";
import { createFindingService } from "./services/findingService.ts";
import type { AppServices } from "./services/index.ts";
import { createNotifier, type Mailer } from "./services/notifier.ts";
import { createScanService } from "./services/scanService.ts";
import { createSettingsService } from "./services/settingsService.ts";

export interface AppDeps {
  /** SQLite 파일 경로. 같은 경로로 다시 만들면 서버 재시작과 같다. */
  dbPath: string;
  /** `githubTokenSource === "none"` 이면 null */
  github: GitHubClient | null;
  githubTokenSource: TokenSource;
  mailer: Mailer;
  /** `config.smtp !== null` (= `isSmtpConfigured`: SMTP_HOST && SMTP_FROM) */
  smtpConfigured: boolean;
  clock: Clock;
  /** 기본 consoleLogger */
  logger?: Logger;
  /** 설정 초기값 env. 키가 settings 에 없을 때만 넣는다 */
  initialSettings?: InitialSettingsEnv;
  /** 빌드된 web 위치. null 이거나 없으면 정적 파일과 SPA 폴백을 건너뛴다 */
  webDistDir?: string | null;
}

export interface AppInstance {
  /** REST(`/api/*`) + MCP(`/mcp`) + 정적 파일. 테스트는 `app.request()` 로 호출한다. */
  app: Hono;
  db: Db;
  services: AppServices;
  /** 만들기만 한다. `start()` 는 index.ts 가 호출하고 테스트는 `tick()` 을 직접 호출한다. */
  scheduler: Scheduler;
  /** 스케줄러를 멈추고 실행 중인 스캔이 끝나기를 기다린 뒤 DB 를 닫는다. */
  close(): Promise<void>;
}

const RESTART_ERROR = "서버 재시작";

interface InitialSetting {
  key: SettingKey;
  env: string;
  raw: string | undefined;
  schema: z.ZodType;
  toInput: (raw: string) => unknown;
  toStored: (value: unknown) => string;
}

/** 설정 초기값 env 를 키별로 검증·정규화해서 그 키가 없을 때만 넣는다. 실패한 키는 경고 후 기본값을 쓴다. */
function applyInitialSettings(repos: Repositories, initial: InitialSettingsEnv, logger: Logger): void {
  const settings: InitialSetting[] = [
    { key: "org", env: "GITHUB_ORG", raw: initial.org, schema: orgSchema, toInput: (raw) => raw, toStored: String },
    {
      key: "scan_interval_hours",
      env: "SCAN_INTERVAL_HOURS",
      raw: initial.scanIntervalHours,
      schema: scanIntervalHoursSchema,
      toInput: (raw) => Number(raw.trim()),
      toStored: String,
    },
    {
      key: "digest_time",
      env: "DIGEST_TIME",
      raw: initial.digestTime,
      schema: digestTimeSchema,
      toInput: (raw) => raw.trim(),
      toStored: String,
    },
    {
      key: "recipients",
      env: "EMAIL_RECIPIENTS",
      raw: initial.recipients,
      schema: recipientsSchema,
      toInput: (raw) => raw.split(",").map((value) => value.trim()).filter((value) => value !== ""),
      toStored: (value) => JSON.stringify(value),
    },
  ];
  for (const setting of settings) {
    if (setting.raw === undefined || setting.raw.trim() === "") continue;
    const result = setting.schema.safeParse(setting.toInput(setting.raw));
    if (!result.success) {
      logger.warn(
        `설정 초기값 ${setting.env} 가 올바르지 않아 무시하고 기본값을 씁니다: ${result.error.issues[0]?.message ?? ""}`,
      );
      continue;
    }
    repos.settings.insertIfMissing(setting.key, setting.toStored(result.data));
  }
}

/** 빌드된 web 이 있는가(`index.html` 존재). index.ts 의 시작 로그도 같은 판정을 쓴다. */
export function hasWebDist(dir: string | null | undefined): dir is string {
  return typeof dir === "string" && dir !== "" && existsSync(join(dir, "index.html"));
}

/**
 * 앱 조립. 동기로 DB 를 열고 시작 보정을 끝낸다:
 * running 으로 남은 스캔 → failed("서버 재시작"), 설정 초기값(`INSERT OR IGNORE`),
 * `next_scan_at` 이 없고 org·토큰이 있으면 `시작 시각 + 1분`.
 */
export function createApp(deps: AppDeps): AppInstance {
  const { clock, githubTokenSource, smtpConfigured } = deps;
  const logger = deps.logger ?? consoleLogger;
  const db = openDatabase(deps.dbPath);
  const repos = createRepositories(db);

  // ---- 시작 보정
  const startedAt = clock.now();
  const interrupted = repos.scans.failRunning(RESTART_ERROR, toIso(startedAt));
  if (interrupted > 0) logger.warn(`서버 재시작으로 중단된 스캔 ${interrupted}건을 failed 로 기록했습니다`);
  applyInitialSettings(repos, deps.initialSettings ?? {}, logger);
  if (
    canScan(repos.settings.get("org"), githubTokenSource) &&
    repos.settings.get("next_scan_at") === null
  ) {
    repos.settings.set("next_scan_at", toIso(addMs(startedAt, FIRST_SCAN_DELAY_MS)));
  }

  // ---- 서비스
  const notifier = createNotifier({ repos, mailer: deps.mailer, smtpConfigured, clock, logger });
  const scans = createScanService({
    repos,
    github: deps.github,
    githubTokenSource,
    notifier,
    clock,
    logger,
  });
  const services: AppServices = {
    findings: createFindingService({ repos, githubTokenSource }),
    blacklist: createBlacklistService({ repos, clock }),
    scans,
    settings: createSettingsService({ repos, clock, githubTokenSource, smtpConfigured }),
    notifier,
  };
  const scheduler = createScheduler({ repos, scans, notifier, clock, githubTokenSource, logger });

  // ---- HTTP
  const app = new Hono();
  app.onError((error, c) => {
    // MCP transport 가 만든 JSON-RPC 오류 응답은 그대로 보낸다.
    if (error instanceof HTTPException) return error.getResponse();
    if (!(error instanceof AppError)) logger.error(`${c.req.method} ${c.req.path} 처리 중 예외`, error);
    return toErrorResponse(c, error);
  });

  app.route("/api", createFindingRoutes(services));
  app.route("/api", createBlacklistRoutes(services));
  app.route("/api", createScanRoutes(services));
  app.route("/api", createSettingsRoutes(services));
  // 등록되지 않은 /api/* 는 SPA 로 폴백하지 않는다.
  app.all("/api/*", (c) => toErrorResponse(c, new AppError("NOT_FOUND", "요청한 API 가 없습니다")));
  app.route("/", createMcpRoutes(services, logger));

  if (hasWebDist(deps.webDistDir)) {
    const root = deps.webDistDir;
    app.use("*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }
  // [Assumption] /api·/mcp 밖에서 처리되지 않은 요청(web 빌드 없음, GET 이 아닌 요청)도 404 ApiError(JSON) — 근거: 계약은 /api/* 404 와 SPA 폴백만 정한다.
  app.notFound((c) => toErrorResponse(c, new AppError("NOT_FOUND", "요청한 경로가 없습니다")));

  let closing: Promise<void> | null = null;
  return {
    app,
    db,
    services,
    scheduler,
    close() {
      closing ??= (async () => {
        scheduler.stop();
        await scans.waitForIdle();
        db.close();
      })();
      return closing;
    },
  };
}
