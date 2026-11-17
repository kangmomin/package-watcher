import {
  FEED_KINDS,
  feedEntriesQuerySchema,
  type FeedEntry,
  type FeedKind,
  type FeedKindStatus,
  type FeedStatus,
  type Page,
} from "@pw/shared";
import type { Clock } from "../clock.ts";
import { AppError } from "../errors.ts";
import type { FeedClient } from "../feed/client.ts";
import { createFeedIndex, type FeedIndex } from "../feed/index.ts";
import { runFeedSync, SYNC_KEYS, type FeedSyncResult } from "../feed/sync.ts";
import type { Logger } from "../logger.ts";
import type { Repositories } from "../repositories/index.ts";
import { parseInput, readStoredSettings } from "./common.ts";

/** 스캔이 읽는 쪽. 스캔은 feed 의 동기화 상태를 몰라도 된다. */
export interface FeedSource {
  /**
   * 켜져 있고 항목이 1건 이상이면 대조 index, 아니면 null. 내용이나 취약점의 기준 점수가 바뀐 경우에만 다시 만든다.
   * 취약점(cve)은 기준 점수를 통과한 행만 들어간다.
   */
  getIndex(): FeedIndex | null;
}

export interface FeedService extends FeedSource {
  getStatus(): FeedStatus;
  /**
   * 수동 동기화를 백그라운드로 시작하고 시작한 뒤의 상태를 반환한다.
   * 판정 순서: feed 꺼짐 → INVALID_STATE, 토큰 없음 → TOKEN_MISSING, 실행 중 → FEED_SYNC_RUNNING.
   */
  startSync(): FeedStatus;
  /** 서버 시작 뒤 1회. feed 가 켜져 있고 토큰이 있으면 백그라운드로 시작한다. 실패해도 throw 하지 않는다. */
  startBackground(): void;
  /**
   * 스캔 직전: 동기화를 (실행 중이 아니면 시작해서) 최대 `maxWaitMs` 기다린다. 넘으면 기다리지 않고 돌아온다.
   * feed 가 꺼져 있거나 토큰이 없으면 바로 돌아온다. throw 하지 않는다.
   */
  syncBeforeScan(maxWaitMs: number): Promise<void>;
  /** `feedEntriesQuerySchema` 로 검증한 쪽 나눔 목록 */
  entries(query: unknown): Page<FeedEntry>;
  /** 실행 중인 동기화가 끝나기를 기다린다. 실행 중이 아니면 바로 끝난다 */
  waitForIdle(): Promise<void>;
  /** 진행 중인 동기화를 현재 페이지에서 멈추게 하고 끝나기를 기다린다 (서버 종료 전) */
  stop(): Promise<void>;
}

export interface FeedServiceDeps {
  repos: Repositories;
  /** 토큰이 없으면 null */
  client: FeedClient | null;
  clock: Clock;
  logger: Logger;
  /** 쪽 단위 재시도의 대기(ms). 기본 2초, 5초, 15초. 테스트는 빈 배열 */
  retryDelaysMs?: readonly number[];
  /** 재시도 사이의 대기. 테스트가 바꾼다 */
  sleep?: (ms: number) => Promise<void>;
  /** 전체 동기화가 오류로 멈춘 뒤 자동으로 이어받기까지의 지연(ms). 기본 5분. null 이면 자동 이어받기를 하지 않는다 */
  autoResumeDelayMs?: number | null;
  /** rate limit 으로 멈춘 뒤의 지연(ms). 기본 1시간 */
  rateLimitResumeDelayMs?: number;
  /** 타이머. 테스트가 바꾼다. 기본은 unref 한 setTimeout */
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
}

/** 자동 이어받기는 연속 이만큼까지 시도한다 (성공하면 초기화) */
const MAX_AUTO_RESUMES = 3;
const AUTO_RESUME_DELAY_MS = 5 * 60_000;
const RATE_LIMIT_RESUME_DELAY_MS = 60 * 60_000;

const defaultSetTimer = (fn: () => void, ms: number): { cancel(): void } => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
};

const TOKEN_MISSING_MESSAGE =
  "GitHub 토큰이 없어 외부 목록을 동기화할 수 없습니다. GITHUB_TOKEN 환경 변수를 설정하거나 gh auth login 을 실행한 뒤 서버를 다시 시작하십시오";

export function createFeedService(deps: FeedServiceDeps): FeedService {
  const { repos, client, clock, logger } = deps;
  let running: Promise<void> | null = null;
  let syncedSoFar = 0;
  let stopping = false;
  /** feed 의 행이 바뀔 때마다 올린다. index 캐시가 이 값으로 낡았는지 판단한다 */
  let revision = 0;
  let cached: { revision: number; enabled: boolean; cveMinScore: number; index: FeedIndex | null } | null = null;
  const setTimer = deps.setTimer ?? defaultSetTimer;
  const autoResumeDelay = deps.autoResumeDelayMs === undefined ? AUTO_RESUME_DELAY_MS : deps.autoResumeDelayMs;
  let resumeTimer: { cancel(): void } | null = null;
  /** 분류마다 연속으로 멈춘 횟수 (성공하면 0) */
  const failures: Record<FeedKind, number> = { malware: 0, cve: 0 };
  /** 마지막으로 rate limit 으로 멈춘 시각(ms, 메모리). 스캔 직전의 동기화가 그 뒤 1시간은 시작하지 않게 한다 */
  let rateLimitedAt: number | null = null;
  const rateLimitWaitMs = (): number => deps.rateLimitResumeDelayMs ?? RATE_LIMIT_RESUME_DELAY_MS;

  const isEnabled = (): boolean => readStoredSettings(repos.settings).feedEnabled;

  function clearResumeTimer(): void {
    resumeTimer?.cancel();
    resumeTimer = null;
  }

  /**
   * 분류 1개의 결과로 다음 자동 이어받기까지의 지연(ms)을 정한다. 이어받지 않으면 null.
   * 전체 동기화가 오류로 멈춘 것만 대상이다. 연속 실패 횟수는 분류마다 센다.
   */
  function resumeDelayOf(kind: FeedKind, result: FeedSyncResult): number | null {
    if (result.status === "ok") {
      failures[kind] = 0;
      return null;
    }
    // 중지 요청으로 끝난 실행은 실패가 아니다
    if (result.status === "stopped" || !result.full || autoResumeDelay === null || stopping) return null;
    // 쪽을 진행했다면 "연속" 실패가 아니다 — 매번 수백 쪽씩 진행하다 멈추는 경우에 3번 만에 포기하지 않는다
    if (result.progressed) failures[kind] = 0;
    failures[kind] += 1;
    if (failures[kind] > MAX_AUTO_RESUMES) return null;
    return result.status === "rateLimited" ? rateLimitWaitMs() : autoResumeDelay;
  }

  /** 분류별 결과(실행한 것만)로 rate limit 기록과 자동 이어받기 타이머를 정한다. 이미 실행 중이거나 꺼졌으면 타이머가 하지 않는다 */
  function scheduleResume(results: [FeedKind, FeedSyncResult][]): void {
    if (results.some(([, result]) => result.status === "rateLimited")) rateLimitedAt = clock.now().getTime();
    else if (results.length > 0 && results.every(([, result]) => result.status === "ok")) rateLimitedAt = null;
    const delays = results.flatMap(([kind, result]) => resumeDelayOf(kind, result) ?? []);
    if (delays.length === 0) return;
    clearResumeTimer();
    resumeTimer = setTimer(() => {
      resumeTimer = null;
      if (running || stopping || !client || !isEnabled()) return;
      launch();
    }, Math.min(...delays));
  }

  /** malware 먼저, 그 다음 cve(기준이 0 이면 하지 않는다). 한 분류가 실패해도 다음 분류를 시도한다 */
  async function runKinds(feedClient: FeedClient): Promise<[FeedKind, FeedSyncResult][]> {
    const kinds: FeedKind[] = readStoredSettings(repos.settings).cveMinScore > 0 ? ["malware", "cve"] : ["malware"];
    const results: [FeedKind, FeedSyncResult][] = [];
    let processedBefore = 0;
    for (const kind of kinds) {
      if (stopping || !isEnabled()) break;
      const base = processedBefore;
      let last = 0;
      const result = await runFeedSync({
        kind,
        repos,
        client: feedClient,
        clock,
        logger,
        onChange: () => {
          revision += 1;
        },
        onProgress: (processed) => {
          last = processed;
          syncedSoFar = base + processed;
        },
        shouldStop: () => stopping || !isEnabled(),
        retryDelaysMs: deps.retryDelaysMs,
        sleep: deps.sleep,
      });
      processedBefore += last;
      results.push([kind, result]);
    }
    return results;
  }

  function launch(): Promise<void> {
    if (!client) throw new AppError("TOKEN_MISSING", TOKEN_MISSING_MESSAGE);
    clearResumeTimer();
    syncedSoFar = 0;
    const done = runKinds(client)
      .then((results) => scheduleResume(results))
      .catch((error: unknown) => logger.error("외부 목록 동기화 중 예상하지 못한 오류", error))
      .finally(() => {
        running = null;
        syncedSoFar = 0;
      });
    running = done;
    return done;
  }

  function kindStatus(kind: FeedKind): FeedKindStatus {
    const keys = SYNC_KEYS[kind];
    return {
      entryCount: repos.feed.count(kind),
      skippedCount: Number(repos.settings.get(keys.skipped)) || 0,
      lastSyncedAt: repos.settings.get(keys.lastSyncedAt),
      fullSyncDone: repos.settings.get(keys.fullDone) === "true",
      lastError: repos.settings.get(keys.lastError),
    };
  }

  /** 맨 위의 값은 두 분류의 합이다: 수는 더하고, fullSyncDone 은 켜진 분류(cve 는 기준이 0 이 아닐 때)가 모두 끝났을 때 true, lastSyncedAt 은 켜진 분류의 가장 오래된 것, lastError 는 먼저 있는 것 */
  function getStatus(): FeedStatus {
    const byKind = { malware: kindStatus("malware"), cve: kindStatus("cve") };
    const byEcosystem = repos.feed.countsByEcosystem();
    const cveOn = readStoredSettings(repos.settings).cveMinScore > 0;
    // 마지막 동기화 = 켜진 분류가 모두 동기화한 시각(가장 오래된 것). 한 분류라도 아직 없으면 null
    const synced = FEED_KINDS.filter((kind) => kind === "malware" || cveOn).map((kind) => byKind[kind].lastSyncedAt);
    const oldest = synced.some((value) => value === null) ? null : ([...synced].sort()[0] ?? null);
    return {
      enabled: isEnabled(),
      byKind,
      entryCount: byKind.malware.entryCount + byKind.cve.entryCount,
      byEcosystem,
      skippedCount: byKind.malware.skippedCount + byKind.cve.skippedCount,
      lastSyncedAt: oldest,
      fullSyncDone: byKind.malware.fullSyncDone && (!cveOn || byKind.cve.fullSyncDone),
      syncing: running !== null,
      syncedSoFar: running !== null ? syncedSoFar : 0,
      lastError: byKind.malware.lastError ?? byKind.cve.lastError,
    };
  }

  return {
    getStatus,
    startSync() {
      if (!isEnabled()) throw new AppError("INVALID_STATE", "외부 목록이 꺼져 있습니다. 설정에서 먼저 켜십시오");
      if (!client) throw new AppError("TOKEN_MISSING", TOKEN_MISSING_MESSAGE);
      if (running) throw new AppError("FEED_SYNC_RUNNING", "외부 목록 동기화가 이미 실행 중입니다");
      launch();
      return getStatus();
    },
    startBackground() {
      if (!client || running || !isEnabled()) return;
      launch();
    },
    async syncBeforeScan(maxWaitMs) {
      try {
        if (!client || !isEnabled()) return;
        // rate limit 으로 멈춘 뒤 1시간은 시작하지 않는다(스캔마다 호출해서 한도를 더 태우지 않게). 수동 실행은 막지 않는다.
        if (!running && rateLimitedAt !== null && clock.now().getTime() - rateLimitedAt < rateLimitWaitMs()) return;
        const sync = running ?? launch();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, maxWaitMs);
          timer.unref?.();
        });
        try {
          await Promise.race([sync, timeout]);
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        logger.error("스캔 전의 외부 목록 동기화 중 오류", error);
      }
    },
    entries(query) {
      return repos.feed.list(parseInput(feedEntriesQuerySchema, query ?? {}));
    },
    getIndex() {
      const enabled = isEnabled();
      if (!enabled) return null;
      const { cveMinScore } = readStoredSettings(repos.settings);
      if (!cached || cached.revision !== revision || cached.enabled !== enabled || cached.cveMinScore !== cveMinScore) {
        const index = createFeedIndex(repos.feed.iterateIndexRows(cveMinScore));
        cached = { revision, enabled, cveMinScore, index: index.size > 0 ? index : null };
      }
      return cached.index;
    },
    async waitForIdle() {
      while (running) await running.catch(() => undefined);
    },
    async stop() {
      stopping = true;
      clearResumeTimer();
      while (running) await running.catch(() => undefined);
    },
  };
}
