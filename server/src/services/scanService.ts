import type { Page, Scan, ScanTrigger } from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { TokenSource } from "../config.ts";
import type { GitHubClient } from "../github/client.ts";
import type { Logger } from "../logger.ts";
import { notImplemented } from "../notImplemented.ts";
import type { Repositories } from "../repositories/index.ts";
import type { Notifier } from "./notifier.ts";

/** repo 동시 처리 수 */
export const REPO_CONCURRENCY = 5;

export interface ScanService {
  /**
   * 판정 순서 ORG_NOT_SET → TOKEN_MISSING → SCAN_RUNNING (AppError). 통과하면 running 행을 만들고
   * 스캔을 백그라운드로 시작한 뒤 running `Scan` 을 바로 반환한다. 백그라운드 promise 는 항상 catch 한다.
   */
  start(trigger: ScanTrigger): Scan;
  /**
   * `start` + 완료 대기. 종료된 `Scan`(success / partial / failed)을 반환한다.
   * 실행 중 예외는 reject 하지 않고 failed 로 끝낸 행을 반환한다. 시작 판정 실패만 AppError 로 reject.
   */
  runScan(trigger: ScanTrigger): Promise<Scan>;
  isRunning(): boolean;
  /** 실행 중인 스캔이 메일 발송과 lock 해제까지 끝날 때까지 기다린다. 실행 중이 아니면 바로 끝난다. */
  waitForIdle(): Promise<void>;
  /** `scansQuerySchema` 로 검증한 뒤 목록 (`startedAt` 내림차순, 같으면 `id` 내림차순) */
  list(query: unknown): Page<Scan>;
  /** 없는 id → NOT_FOUND */
  get(id: number): Scan;
}

export interface ScanServiceDeps {
  repos: Repositories;
  /** 토큰이 없으면 null */
  github: GitHubClient | null;
  githubTokenSource: TokenSource;
  notifier: Notifier;
  clock: Clock;
  logger: Logger;
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  return notImplemented(deps);
}
