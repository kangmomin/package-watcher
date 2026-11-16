import type { Severity } from "@pw/shared";
import { z } from "zod";
import type { Clock } from "../clock.ts";
import { RateLimitedError } from "../github/client.ts";
import { errorMessage } from "../lockfiles/common.ts";
import type { Logger } from "../logger.ts";
import type { FeedWrite } from "../repositories/feed.ts";
import type { Repositories } from "../repositories/index.ts";
import { HOUR_MS, printable, toIso } from "../services/common.ts";
import type { FeedClient } from "./client.ts";
import { convertAdvisory } from "./ranges.ts";

const SUMMARY_MAX = 300;
const URL_MAX = 500;
/** 증분 동기화가 "마지막 동기화의 시작 시각"보다 이만큼 더 거슬러 올라간다(그 사이의 갱신을 놓치지 않으려고) */
const OVERLAP_MS = HOUR_MS;

const SEVERITY_OF: Record<string, Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  LOW: "low",
};

const isDate = (value: string): boolean => !Number.isNaN(Date.parse(value));

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
  }),
});

export interface FeedSyncDeps {
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
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function describeError(error: unknown): string {
  if (error instanceof RateLimitedError) return "GitHub API 호출 한도를 소진했습니다. 다음 동기화에서 이어서 받습니다";
  return errorMessage(error) || "알 수 없는 오류";
}

interface Group {
  externalId: string;
  ecosystem: FeedWrite["ecosystem"];
  name: string;
  entries: Map<string, FeedWrite>;
}

const groupKey = (externalId: string, ecosystem: string, name: string): string =>
  `${externalId}\u0000${ecosystem}\u0000${name}`;

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

/** 페이지 1개를 반영한다. 호출 쪽이 연 트랜잭션 안에서 부른다. */
function processPage(rawNodes: unknown[], repos: Repositories, replaced: Set<string>, threshold: number): PageOutcome {
  let skipped = 0;
  let changed = 0;
  let reachedOld = false;
  const withdrawn = new Set<string>();
  const groups = new Map<string, Group>();

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
      // 지원하는 종류인데 범위만 읽지 못했다면 같은 권고의 옛 범위가 남지 않게 빈 집합으로 교체한다.
      const known = convertAdvisory(node.package.ecosystem, node.package.name, ">= 0");
      if (known) {
        const key = groupKey(ghsaId, known.ecosystem, known.name);
        if (!groups.has(key)) {
          groups.set(key, { externalId: ghsaId, ecosystem: known.ecosystem, name: known.name, entries: new Map() });
        }
      }
      continue;
    }
    const key = groupKey(ghsaId, converted.ecosystem, converted.name);
    let group = groups.get(key);
    if (!group) {
      group = { externalId: ghsaId, ecosystem: converted.ecosystem, name: converted.name, entries: new Map() };
      groups.set(key, group);
    }
    group.entries.set(converted.versionRange ?? "", {
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

  for (const externalId of withdrawn) changed += repos.feed.deleteByExternalId(externalId);
  for (const [key, group] of groups) {
    if (withdrawn.has(group.externalId)) continue;
    changed += repos.feed.replaceGroup(
      group.externalId,
      group.ecosystem,
      group.name,
      [...group.entries.values()],
      !replaced.has(key),
    );
    replaced.add(key);
  }
  return { skipped, changed, reachedOld };
}

/**
 * 동기화 1회. 처음(또는 중단된 전체 동기화)이면 모든 페이지를, 아니면 마지막 동기화 이후 바뀐 것만 받는다.
 * 절대 throw 하지 않는다 — 실패는 `feed_last_error` 에 저장하고 호출 쪽(백그라운드)은 그대로 둔다.
 */
export async function runFeedSync(deps: FeedSyncDeps): Promise<void> {
  const { repos, client, clock, logger } = deps;
  const settings = repos.settings;

  try {
    const startedAt = toIso(clock.now());
    const fullDone = settings.get("feed_full_sync_done") === "true";
    let cursor: string | null = fullDone ? null : settings.get("feed_cursor");
    let skipped = fullDone || cursor === null ? 0 : Number(settings.get("feed_skipped")) || 0;
    let threshold = Number.NEGATIVE_INFINITY;
    if (fullDone) {
      const last = Date.parse(settings.get("feed_last_started_at") ?? "");
      // 시작 시각이 없으면(깨진 설정) 증분이 아니라 많이 받는다.
      threshold = Number.isNaN(last) ? Number.NEGATIVE_INFINITY : last - OVERLAP_MS;
    } else if (cursor === null) {
      // 새 전체 동기화. 여러 번에 나눠 받아도 이 시각이 나중의 증분 기준이 된다.
      settings.set("feed_full_started_at", startedAt);
    }
    // 이번 실행에서 이미 교체한 (권고, 패키지). 같은 권고의 범위가 여러 페이지에 나뉘어 와도 앞 페이지의 범위를 지우지 않는다.
    const replaced = new Set<string>();
    let processed = 0;

    for (;;) {
      const page = await client.fetchPage(cursor);
      const nextCursor = page.nextCursor;
      const outcome = repos.transaction(() => {
        const result = processPage(page.nodes, repos, replaced, threshold);
        if (!fullDone) {
          // 이어받기 위치와 건너뛴 수를 페이지와 같은 트랜잭션에 저장한다.
          settings.set("feed_cursor", nextCursor);
          settings.set("feed_skipped", String(skipped + result.skipped));
        }
        return result;
      });
      skipped += outcome.skipped;
      processed += page.nodes.length;
      if (outcome.changed > 0) deps.onChange();
      deps.onProgress(processed);

      cursor = nextCursor;
      if (cursor === null || outcome.reachedOld) break;
      if (deps.shouldStop()) return;
      await yieldToEventLoop();
    }

    repos.transaction(() => {
      if (!fullDone) {
        settings.set("feed_full_sync_done", "true");
        settings.set("feed_cursor", null);
        settings.set("feed_skipped", String(skipped));
        settings.set("feed_last_started_at", settings.get("feed_full_started_at") ?? startedAt);
        settings.set("feed_full_started_at", null);
      } else {
        settings.set("feed_last_started_at", startedAt);
      }
      settings.set("feed_last_synced_at", toIso(clock.now()));
      settings.set("feed_last_error", null);
    });
  } catch (error) {
    logger.error("외부 목록(feed) 동기화에 실패했습니다", error);
    try {
      settings.set("feed_last_error", describeError(error));
    } catch (saveError) {
      logger.error("외부 목록 동기화의 오류를 저장하지 못했습니다", saveError);
    }
  }
}
