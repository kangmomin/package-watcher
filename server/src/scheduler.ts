import type { Clock } from "./clock.ts";
import type { TokenSource } from "./config.ts";
import type { Logger } from "./logger.ts";
import type { Repositories } from "./repositories/index.ts";
import { addMs, canScan, HOUR_MS, readStoredSettings, toIso, toKst } from "./services/common.ts";
import type { Notifier } from "./services/notifier.ts";
import type { ScanService } from "./services/scanService.ts";

export const TICK_INTERVAL_MS = 30_000;
/** `next_scan_at` 이 없을 때 첫 자동 스캔까지의 지연 (A-7) */
export const FIRST_SCAN_DELAY_MS = 60_000;

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
   *   요약 발송은 tick 안에서 끝까지 기다린다. KST 계산은 `toKst`(services/common, `Intl` 만 사용)를 쓴다.
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

/**
 * 원래 격자의 다음 미래 시각: `next + ceil((now − next) / interval) × interval`.
 * 결과는 항상 `now` 보다 뒤다(같거나 이르면 interval 을 1번 더 더한다, S-1).
 */
export function nextOnGrid(next: Date, now: Date, intervalMs: number): Date {
  const steps = Math.max(1, Math.ceil((now.getTime() - next.getTime()) / intervalMs));
  let candidate = next.getTime() + steps * intervalMs;
  if (candidate <= now.getTime()) candidate += intervalMs;
  return new Date(candidate);
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { repos, scans, notifier, clock, githubTokenSource, logger } = deps;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function runAutoScan(now: Date): void {
    const settings = readStoredSettings(repos.settings);
    if (!canScan(settings.org, githubTokenSource)) return;

    const stored = repos.settings.get("next_scan_at");
    const next = stored === null ? Number.NaN : Date.parse(stored);
    if (Number.isNaN(next)) {
      repos.settings.set("next_scan_at", toIso(addMs(now, FIRST_SCAN_DELAY_MS)));
      return;
    }
    if (now.getTime() < next) return;

    // 서버가 오래 꺼져 있었어도 1회만 실행하고, 실행 중이면 그 회차를 건너뛴다. 두 경우 모두 격자를 옮긴다.
    const intervalMs = settings.scanIntervalHours * HOUR_MS;
    repos.settings.set("next_scan_at", toIso(nextOnGrid(new Date(next), now, intervalMs)));
    if (scans.isRunning()) {
      logger.info("예정된 자동 스캔 시각이지만 스캔이 실행 중이라 이번 회차를 건너뜁니다");
      return;
    }
    scans.start("scheduled");
  }

  async function runDigest(now: Date): Promise<void> {
    const { digestTime } = readStoredSettings(repos.settings);
    const kst = toKst(now);
    if (repos.settings.get("last_digest_date") === kst.date || kst.time < digestTime) return;
    // 발송 전에 기록한다. 실패해도 그날은 다시 시도하지 않는다.
    repos.settings.set("last_digest_date", kst.date);
    await notifier.sendDigest();
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const now = clock.now();
      try {
        runAutoScan(now);
      } catch (error) {
        logger.error("자동 스캔 판정 중 오류", error);
      }
      try {
        await runDigest(now);
      } catch (error) {
        logger.error("일일 요약 처리 중 오류", error);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
