import type { FeedKind, Severity } from "@pw/shared";
import { z } from "zod";
import type { Clock } from "../clock.ts";
import { RateLimitedError } from "../github/client.ts";
import { errorMessage } from "../lockfiles/common.ts";
import type { Logger } from "../logger.ts";
import type { FeedWrite } from "../repositories/feed.ts";
import type { Repositories } from "../repositories/index.ts";
import type { SettingKey } from "../repositories/settings.ts";
import { HOUR_MS, printable, toIso } from "../services/common.ts";
import { FatalFeedError, InvalidCursorError, type FeedClient } from "./client.ts";
import { convertAdvisory } from "./ranges.ts";

const SUMMARY_MAX = 300;
const URL_MAX = 500;
/** 증분 동기화가 "마지막 동기화의 시작 시각"보다 이만큼 더 거슬러 올라간다(그 사이의 갱신을 놓치지 않으려고) */
const OVERLAP_MS = HOUR_MS;
/** 마지막 전체 동기화가 끝난 지 이만큼 지나면 다음 동기화는 전체로 한다(철회·범위 변경을 증분이 놓칠 수 있다) */
export const FULL_RESYNC_MS = 7 * 24 * HOUR_MS;

const SEVERITY_OF: Record<string, Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  LOW: "low",
};

const isDate = (value: string): boolean => !Number.isNaN(Date.parse(value));

/** 분류마다 따로 저장하는 동기화 상태의 키. malware 는 운영 DB 에 이미 있는 `feed_*` 를 그대로 쓴다 */
export interface SyncKeys {
  fullDone: SettingKey;
  cursor: SettingKey;
  fullStartedAt: SettingKey;
  runId: SettingKey;
  lastFullAt: SettingKey;
  lastStartedAt: SettingKey;
  lastSyncedAt: SettingKey;
  skipped: SettingKey;
  lastError: SettingKey;
}

export const SYNC_KEYS: Readonly<Record<FeedKind, SyncKeys>> = {
  malware: {
    fullDone: "feed_full_sync_done",
    cursor: "feed_cursor",
    fullStartedAt: "feed_full_started_at",
    runId: "feed_run_id",
    lastFullAt: "feed_last_full_at",
    lastStartedAt: "feed_last_started_at",
    lastSyncedAt: "feed_last_synced_at",
    skipped: "feed_skipped",
    lastError: "feed_last_error",
  },
  cve: {
    fullDone: "feed_cve_full_sync_done",
    cursor: "feed_cve_cursor",
    fullStartedAt: "feed_cve_full_started_at",
    runId: "feed_cve_run_id",
    lastFullAt: "feed_cve_last_full_at",
    lastStartedAt: "feed_cve_last_started_at",
    lastSyncedAt: "feed_cve_last_synced_at",
    skipped: "feed_cve_skipped",
    lastError: "feed_cve_last_error",
  },
};

const PATCHED_MAX = 100;

const scoreSchema = z.object({ score: z.number().nullish() }).nullish().catch(null);

// 외부 응답은 믿지 않는다: 노드마다 검증하고, 맞지 않는 노드만 건너뛴다.
const nodeSchema = z.object({
  updatedAt: z.string().refine(isDate),
  vulnerableVersionRange: z.string(),
  package: z.object({ ecosystem: z.string(), name: z.string() }),
  advisory: z.object({
    ghsaId: z.string().regex(/^GHSA-[A-Za-z0-9-]{1,60}$/),
    summary: z.string().nullish(),
    severity: z.string(),
    permalink: z.string().nullish(),
    withdrawnAt: z.string().nullish(),
    // 일반 취약점(cve)의 쿼리만 이 필드들을 받는다. 모양이 달라도 노드를 건너뛰지 않고 "없음"으로 본다.
    cvssSeverities: z.object({ cvssV3: scoreSchema, cvssV4: scoreSchema }).nullish().catch(null),
  }),
  firstPatchedVersion: z.object({ identifier: z.string().nullish() }).nullish().catch(null),
});

interface CvssSeverities {
  cvssV3?: { score?: number | null } | null;
  cvssV4?: { score?: number | null } | null;
}

/** CVSS 점수 = v3 와 v4 중 큰 값. 0·없음·범위 밖은 null (점수가 없는 권고는 등급으로 판단한다) */
export function cvssScoreOf(severities: CvssSeverities | null | undefined): number | null {
  const scores = [severities?.cvssV3?.score, severities?.cvssV4?.score].filter(
    (score): score is number => typeof score === "number" && Number.isFinite(score) && score > 0 && score <= 10,
  );
  return scores.length === 0 ? null : Math.max(...scores);
}

export interface FeedSyncDeps {
  /** 이 실행이 동기화하는 분류. 상태 키·sweep·철회가 모두 이 분류의 범위 안이다 */
  kind: FeedKind;
  repos: Repositories;
  client: FeedClient;
  clock: Clock;
  logger: Logger;
  /** feed 의 행이 바뀌었다 — 스캔의 index 캐시를 다시 만든다 */
  onChange(): void;
  /** 지금까지 처리한 노드의 수 */
  onProgress(processed: number): void;
  /** true 이면 현재 페이지를 마친 뒤 멈춘다(서버 종료, feed 끄기). 이어받기 위치는 저장돼 있다. */
  shouldStop(): boolean;
  /** 쪽 하나를 받다가 rate limit 이 아닌 오류가 나면 이 간격(ms)마다 같은 cursor 로 다시 시도한다. 기본 2초, 5초, 15초 */
  retryDelaysMs?: readonly number[];
  /** 재시도 사이의 대기. 테스트가 바꾼다 */
  sleep?(ms: number): Promise<void>;
}

/** 쪽 단위 재시도의 기본 대기: 최대 3번 더 시도한다 */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

export interface FeedSyncResult {
  status: "ok" | "stopped" | "failed" | "rateLimited";
  /** 전체 동기화였는가(이어받을 수 있는 것) */
  full: boolean;
  /** 이번 실행이 쪽을 1개라도 반영했는가 (자동 이어받기의 연속 실패 횟수를 초기화하는 근거) */
  progressed: boolean;
}

/** 중지 요청(서버 종료, feed 끄기)으로 실행을 마친다 — 실패가 아니다 */
class StopRequested extends Error {}

/** 짧은 조각으로 나눠 기다린다 — 중지 요청에 바로 반응한다 */
async function interruptibleSleep(ms: number, shouldStop: () => boolean): Promise<void> {
  for (let left = ms; left > 0 && !shouldStop(); left -= 250) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, left)));
  }
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function describeError(error: unknown): string {
  if (error instanceof RateLimitedError) return "GitHub API 호출 한도를 소진했습니다. 다음 동기화에서 이어서 받습니다";
  return errorMessage(error) || "알 수 없는 오류";
}

function urlOf(permalink: string | null | undefined, ghsaId: string): string {
  const fallback = `https://github.com/advisories/${ghsaId}`;
  if (!permalink || !/^https:\/\//i.test(permalink) || permalink.length > URL_MAX) return fallback;
  return printable(permalink);
}

interface PageOutcome {
  skipped: number;
  changed: number;
  /** 증분 동기화가 멈출 기준에 도달했는가 */
  reachedOld: boolean;
}

/**
 * 페이지 1개를 반영한다. 호출 쪽이 연 트랜잭션 안에서 부른다. 더하기·갱신과 철회의 삭제만 하고 범위를 정리(prune)하지 않는다 —
 * 같은 권고의 범위가 여러 페이지·여러 실행에 나뉘어 와도 잃지 않는다. 옛 범위는 전체 동기화의 sweep 이 지운다.
 */
function processPage(
  kind: FeedKind,
  rawNodes: unknown[],
  repos: Repositories,
  seenRun: string | null,
  threshold: number,
): PageOutcome {
  let skipped = 0;
  let reachedOld = false;
  const withdrawn = new Set<string>();
  const entries: FeedWrite[] = [];

  for (const raw of rawNodes) {
    const parsed = nodeSchema.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const node = parsed.data;
    // UPDATED_AT DESC 라서 기준보다 오래된 노드부터는 이미 반영한 것이다.
    if (Date.parse(node.updatedAt) < threshold) {
      reachedOld = true;
      break;
    }
    const { ghsaId } = node.advisory;
    if (node.advisory.withdrawnAt) {
      withdrawn.add(ghsaId);
      continue;
    }
    const severity = SEVERITY_OF[node.advisory.severity];
    const converted = severity
      ? convertAdvisory(node.package.ecosystem, node.package.name, node.vulnerableVersionRange)
      : null;
    if (!severity || !converted) {
      skipped += 1;
      continue;
    }
    const patched = printable((node.firstPatchedVersion?.identifier ?? "").trim()).slice(0, PATCHED_MAX);
    entries.push({
      kind,
      cvssScore: kind === "cve" ? cvssScoreOf(node.advisory.cvssSeverities) : null,
      patchedVersion: kind === "cve" && patched !== "" ? patched : null,
      externalId: ghsaId,
      ecosystem: converted.ecosystem,
      name: converted.name,
      versionRange: converted.versionRange,
      rawRange: node.vulnerableVersionRange.slice(0, URL_MAX),
      severity,
      summary: printable((node.advisory.summary ?? "").trim()).slice(0, SUMMARY_MAX),
      url: urlOf(node.advisory.permalink, ghsaId),
      updatedAt: new Date(node.updatedAt).toISOString(),
    });
  }

  let changed = repos.feed.upsert(
    entries.filter((entry) => !withdrawn.has(entry.externalId)),
    seenRun,
  );
  for (const externalId of withdrawn) changed += repos.feed.deleteByExternalId(kind, externalId);
  return { skipped, changed, reachedOld };
}

/**
 * 전체 동기화의 마무리. 호출 쪽의 트랜잭션 안에서 부른다. 반환: 바뀐 행의 수(sweep 과 꺼진 항목).
 * feed 에서 사라진 권고의 항목(malware → `source=feed`, cve → `source=cve`)은 끄고 그 검출은 resolved 로 한다(항목과 검출의 기록은 지우지 않는다).
 * 다른 분류의 행·항목은 건드리지 않는다.
 */
function finishFull(
  kind: FeedKind,
  repos: Repositories,
  runId: string,
  skipped: number,
  startedAt: string,
  now: string,
): number {
  const settings = repos.settings;
  const keys = SYNC_KEYS[kind];
  let changed = repos.feed.sweep(kind, runId);
  if (repos.feed.count(kind) > 0) {
    const disabled = repos.blacklist.disableWithdrawnFeedEntries(kind, now);
    for (const id of disabled) repos.findings.resolveByBlacklistEntry(id, now);
    changed += disabled.length;
  }
  settings.set(keys.fullDone, "true");
  settings.set(keys.cursor, null);
  settings.set(keys.skipped, String(skipped));
  settings.set(keys.lastStartedAt, settings.get(keys.fullStartedAt) ?? startedAt);
  settings.set(keys.fullStartedAt, null);
  settings.set(keys.runId, null);
  settings.set(keys.lastFullAt, now);
  settings.set(keys.lastSyncedAt, now);
  settings.set(keys.lastError, null);
  return changed;
}

/**
 * 분류 1개(`deps.kind`)의 동기화 1회. 아래 중 하나이면 전체, 아니면 마지막 동기화 이후 바뀐 것만(증분) 받는다.
 * - 첫 전체 동기화가 아직 끝나지 않았다(중단된 것은 저장된 cursor 에서 이어받는다)
 * - 마지막 전체 동기화가 끝난 지 7일이 지났다
 * 전체 동기화는 받은 행에 실행 id 를 남기고, 끝나면 이번 실행이 보지 못한 행을 지운다(sweep). 그 전까지 기존 행은 대조에 쓰인다.
 * 절대 throw 하지 않는다 — 실패는 `feed_last_error` 에 저장하고 호출 쪽(백그라운드)은 그대로 둔다.
 */
export async function runFeedSync(deps: FeedSyncDeps): Promise<FeedSyncResult> {
  const { repos, client, clock, logger, kind } = deps;
  const settings = repos.settings;
  const keys = SYNC_KEYS[kind];
  // cve 의 실행 id 는 malware 와 같은 시각이어도 겹치지 않는다(seen_run 은 한 열을 같이 쓴다)
  const runIdOf = (startedAt: string): string => (kind === "cve" ? `cve:${startedAt}` : startedAt);
  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? ((ms: number) => interruptibleSleep(ms, deps.shouldStop));
  let isFull = false;
  let progressed = false;

  /**
   * rate limit·cursor 거부·토큰 문제가 아닌 오류는 같은 cursor 로 delays 만큼 더 시도한다. 마지막 오류를 던진다.
   * 대기 전후에 중지 요청을 확인한다(중지 요청 뒤의 오류는 실패가 아니라 중지다).
   */
  async function fetchWithRetry(cursor: string | null) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await client.fetchPage(kind, cursor);
      } catch (error) {
        if (deps.shouldStop()) throw new StopRequested();
        const delay = delays[attempt];
        const hopeless = error instanceof RateLimitedError || error instanceof InvalidCursorError || error instanceof FatalFeedError;
        if (hopeless || delay === undefined) throw error;
        logger.warn(`외부 목록의 쪽을 받지 못해 ${delay}ms 뒤에 다시 시도합니다 (${attempt + 1}/${delays.length})`, error);
        await sleep(delay);
        if (deps.shouldStop()) throw new StopRequested();
      }
    }
  }

  try {
    const startedAt = toIso(clock.now());
    const fullDone = settings.get(keys.fullDone) === "true";
    let cursor: string | null = settings.get(keys.cursor);
    const lastFullAt = Date.parse(settings.get(keys.lastFullAt) ?? "");
    const stale = fullDone && !Number.isNaN(lastFullAt) && clock.now().getTime() - lastFullAt >= FULL_RESYNC_MS;
    const full = !fullDone || cursor !== null || stale;
    isFull = full;

    let runId = "";
    let skipped = 0;
    let threshold = Number.NEGATIVE_INFINITY;
    if (full) {
      const saved = settings.get(keys.runId);
      if (cursor !== null && saved) {
        runId = saved;
        skipped = Number(settings.get(keys.skipped)) || 0;
      } else {
        // 새 전체 동기화. 여러 번에 나눠 받아도 같은 실행 id 와 시작 시각을 쓴다.
        cursor = null;
        runId = runIdOf(startedAt);
        settings.set(keys.runId, runId);
        settings.set(keys.fullStartedAt, startedAt);
      }
    } else {
      const last = Date.parse(settings.get(keys.lastStartedAt) ?? "");
      // 시작 시각이 없으면(깨진 설정) 증분이 아니라 많이 받는다.
      threshold = Number.isNaN(last) ? Number.NEGATIVE_INFINITY : last - OVERLAP_MS;
    }
    let resumed = cursor !== null;
    let processed = 0;

    for (;;) {
      let page;
      try {
        page = await fetchWithRetry(cursor);
      } catch (error) {
        // GitHub 이 이어받던 cursor 를 거부한 것이 분명할 때만 처음부터 다시 받는다. 같은 실행 id 라서 이미 받은 행은 그대로 유효하다.
        // 저장된 cursor 는 지우지 않는다 — 처음부터의 첫 쪽이 성공해서 새 cursor 로 바뀔 때까지 남는다(그 전에 실패해도 진행을 잃지 않는다).
        if (!resumed || !(error instanceof InvalidCursorError)) throw error;
        logger.warn("GitHub 이 저장된 cursor 를 거부해서 처음부터 다시 받습니다", error);
        resumed = false;
        cursor = null;
        skipped = 0;
        continue;
      }
      resumed = false;
      progressed = true;
      const nextCursor = page.nextCursor;
      let finished = 0;
      const outcome = repos.transaction(() => {
        const result = processPage(kind, page.nodes, repos, full ? runId : null, threshold);
        if (full) {
          settings.set(keys.cursor, nextCursor);
          settings.set(keys.skipped, String(skipped + result.skipped));
          // 마지막 페이지와 마무리(sweep, fullSyncDone, cursor 삭제)는 한 트랜잭션이다 — 사이에 멈춰도 처음부터 다시 받지 않는다.
          if (nextCursor === null) finished = finishFull(kind, repos, runId, skipped + result.skipped, startedAt, toIso(clock.now()));
        }
        return result;
      });
      skipped += outcome.skipped;
      processed += page.nodes.length;
      if (outcome.changed > 0 || finished > 0) deps.onChange();
      deps.onProgress(processed);

      cursor = nextCursor;
      if (cursor === null) {
        if (full) return { status: "ok", full, progressed };
        break;
      }
      if (!full && outcome.reachedOld) break;
      if (deps.shouldStop()) return { status: "stopped", full, progressed };
      await yieldToEventLoop();
    }

    // 증분 동기화의 마무리
    repos.transaction(() => {
      settings.set(keys.lastStartedAt, startedAt);
      settings.set(keys.lastSyncedAt, toIso(clock.now()));
      settings.set(keys.lastError, null);
    });
    return { status: "ok", full, progressed };
  } catch (error) {
    if (error instanceof StopRequested) return { status: "stopped", full: isFull, progressed };
    logger.error(`외부 목록(feed, ${kind}) 동기화에 실패했습니다`, error);
    try {
      settings.set(keys.lastError, describeError(error));
    } catch (saveError) {
      logger.error("외부 목록 동기화의 오류를 저장하지 못했습니다", saveError);
    }
    return { status: error instanceof RateLimitedError ? "rateLimited" : "failed", full: isFull, progressed };
  }
}
