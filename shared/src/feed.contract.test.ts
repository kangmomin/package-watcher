import { describe, expect, it } from "vitest";
import {
  ERROR_HTTP_STATUS,
  blacklistEntrySchema,
  blacklistQuerySchema,
  feedEntriesQuerySchema,
  feedEntrySchema,
  feedStatusSchema,
  settingsInputSchema,
  settingsSchema,
} from "./contract.ts";
import * as fx from "./fixtures.ts";

const FEED_ENTRY = {
  kind: "malware",
  cvssScore: null,
  patchedVersion: null,
  externalId: "GHSA-h6jf-g8cj-x4v3",
  ecosystem: "npm",
  name: "@univerjs-pro/sheets-pivot-chart",
  versionRange: "1.5.1",
  rawRange: "= 1.5.1",
  severity: "critical",
  summary: "Malware in @univerjs-pro/sheets-pivot-chart",
  url: "https://github.com/advisories/GHSA-h6jf-g8cj-x4v3",
  updatedAt: "2026-11-16T00:14:17.000Z",
};

const FEED_STATUS = {
  enabled: true,
  byKind: {
    malware: { entryCount: 151751, skippedCount: 12, lastSyncedAt: "2026-11-16T01:00:00.000Z", fullSyncDone: true, lastError: null },
    cve: { entryCount: 0, skippedCount: 0, lastSyncedAt: null, fullSyncDone: false, lastError: null },
  },
  entryCount: 151751,
  byEcosystem: { npm: 125762, pypi: 17529 },
  skippedCount: 12,
  lastSyncedAt: "2026-11-16T01:00:00.000Z",
  fullSyncDone: true,
  syncing: false,
  syncedSoFar: 0,
  lastError: null,
};

describe("[SE-01] 외부 목록(feed)의 계약", () => {
  it("블랙리스트 항목에 출처가 있다: 사용자가 만든 항목은 manual, externalId 는 null", () => {
    expect(fx.blacklistEntryRanged.source).toBe("manual");
    expect(fx.blacklistEntryRanged.externalId).toBeNull();
    expect(blacklistEntrySchema.safeParse(fx.blacklistEntryRanged).success).toBe(true);
    const feed = { ...fx.blacklistEntryRanged, source: "feed", externalId: "GHSA-h6jf-g8cj-x4v3" };
    expect(blacklistEntrySchema.safeParse(feed).success).toBe(true);
    const { source: _source, ...withoutSource } = fx.blacklistEntryRanged;
    expect(blacklistEntrySchema.safeParse(withoutSource).success).toBe(false);
    expect(blacklistEntrySchema.safeParse({ ...fx.blacklistEntryRanged, source: "other" }).success).toBe(false);
  });

  it("목록의 출처 필터", () => {
    expect(blacklistQuerySchema.parse({ source: "feed" }).source).toBe("feed");
    expect(blacklistQuerySchema.parse({}).source).toBeUndefined();
    expect(blacklistQuerySchema.safeParse({ source: "x" }).success).toBe(false);
  });

  it("feed 의 항목과 상태", () => {
    expect(feedEntrySchema.safeParse(FEED_ENTRY).success).toBe(true);
    expect(feedEntrySchema.safeParse({ ...FEED_ENTRY, versionRange: null, rawRange: ">= 0" }).success).toBe(true);
    expect(feedEntrySchema.safeParse({ ...FEED_ENTRY, versionRange: "" }).success).toBe(false);
    expect(feedStatusSchema.safeParse(FEED_STATUS).success).toBe(true);
    expect(feedStatusSchema.safeParse({ ...FEED_STATUS, lastSyncedAt: null, fullSyncDone: false }).success).toBe(true);
    expect(feedStatusSchema.safeParse({ ...FEED_STATUS, entryCount: -1 }).success).toBe(false);
  });

  it("feed 검색의 query: 기본 page 1, limit 50, 최대 200", () => {
    expect(feedEntriesQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 });
    expect(feedEntriesQuerySchema.parse({ q: "  lodash ", ecosystem: "npm", limit: "200" })).toMatchObject({
      q: "lodash",
      ecosystem: "npm",
      limit: 200,
    });
    expect(feedEntriesQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(feedEntriesQuerySchema.safeParse({ ecosystem: "nope" }).success).toBe(false);
  });

  it("설정의 feedEnabled: 응답에는 필수, 입력에서는 생략할 수 있다", () => {
    expect(fx.settingsDefault.feedEnabled).toBe(true);
    const { feedEnabled: _enabled, ...withoutFeed } = fx.settingsDefault;
    expect(settingsSchema.safeParse(withoutFeed).success).toBe(false);
    const input = { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [] };
    expect(settingsInputSchema.parse(input).feedEnabled).toBeUndefined();
    expect(settingsInputSchema.parse({ ...input, feedEnabled: false }).feedEnabled).toBe(false);
    expect(settingsInputSchema.safeParse({ ...input, feedEnabled: "false" }).success).toBe(false);
  });

  it("동기화가 실행 중일 때의 에러 코드는 409", () => {
    expect(ERROR_HTTP_STATUS.FEED_SYNC_RUNNING).toBe(409);
  });
});
