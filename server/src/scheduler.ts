import type { Clock } from "./clock.ts";
import type { TokenSource } from "./config.ts";
import type { Logger } from "./logger.ts";
import { notImplemented } from "./notImplemented.ts";
import type { Repositories } from "./repositories/index.ts";
import type { Notifier } from "./services/notifier.ts";
import type { ScanService } from "./services/scanService.ts";

export const TICK_INTERVAL_MS = 30_000;

export interface Scheduler {
  /** TICK_INTERVAL_MS 마다 tick() */
  start(): void;
  stop(): void;
  /**
   * 1회 판정. 이전 tick 이 진행 중이면 건너뛴다. 본문은 try/catch.
   * - `next_scan_at` 이 지났으면: 스캔이 실행 중이 아니면 scheduled 스캔을 백그라운드로 시작(완료는 기다리지 않음),
   *   실행 중이면 건너뛴다(스캔 행 없음). 두 경우 모두 `next_scan_at` 을 원래 격자의 다음 미래 시각으로 옮긴다.
   * - org 또는 토큰이 없으면 자동 스캔을 하지 않는다.
   * - 일일 요약: KST 날짜가 바뀌고 `digestTime` 이 지났으면 1회. `last_digest_date` 는 발송 전에 기록한다.
   *   요약 발송은 tick 안에서 끝까지 기다린다. KST 계산은 `Intl`(`timeZone: "Asia/Seoul"`)만 쓴다.
   */
  tick(): Promise<void>;
}

export interface SchedulerDeps {
  repos: Repositories;
  scans: ScanService;
  notifier: Notifier;
  clock: Clock;
  githubTokenSource: TokenSource;
  logger: Logger;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  return notImplemented(deps);
}
