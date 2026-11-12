import type { Hono } from "hono";
import type { Clock } from "./clock.ts";
import type { InitialSettingsEnv, TokenSource } from "./config.ts";
import type { Db } from "./db/index.ts";
import type { GitHubClient } from "./github/client.ts";
import type { Logger } from "./logger.ts";
import { notImplemented } from "./notImplemented.ts";
import type { Scheduler } from "./scheduler.ts";
import type { AppServices } from "./services/index.ts";
import type { Mailer } from "./services/notifier.ts";

export interface AppDeps {
  /** SQLite 파일 경로. 같은 경로로 다시 만들면 서버 재시작과 같다. */
  dbPath: string;
  /** `githubTokenSource === "none"` 이면 null */
  github: GitHubClient | null;
  githubTokenSource: TokenSource;
  mailer: Mailer;
  /** `config.isSmtpConfigured` 결과 */
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

/**
 * 앱 조립. 동기로 DB 를 열고 시작 보정을 끝낸다:
 * running 으로 남은 스캔 → failed("서버 재시작"), 설정 초기값(`INSERT OR IGNORE`),
 * `next_scan_at` 이 없고 org·토큰이 있으면 `시작 시각 + 1분`.
 */
export function createApp(deps: AppDeps): AppInstance {
  return notImplemented(deps);
}
