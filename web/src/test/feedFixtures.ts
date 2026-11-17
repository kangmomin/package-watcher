// 외부 목록(feed) 화면 테스트용 데이터. shared 의 fixtures 에는 feed 예시가 없다.
import type { FeedEntry, FeedStatus, Page } from "@pw/shared";

export const feedStatusDefault: FeedStatus = {
  enabled: true,
  byKind: {
    malware: { entryCount: 151751, skippedCount: 0, lastSyncedAt: "2026-11-16T03:30:00.000Z", fullSyncDone: true, lastError: null },
    cve: { entryCount: 0, skippedCount: 0, lastSyncedAt: "2026-11-16T03:30:00.000Z", fullSyncDone: true, lastError: null },
  },
  entryCount: 151751,
  byEcosystem: { npm: 125762, pypi: 17529, nuget: 4555, rubygems: 3846, cargo: 35, go: 20, maven: 2, composer: 2 },
  skippedCount: 0,
  lastSyncedAt: "2026-11-16T03:30:00.000Z",
  fullSyncDone: true,
  syncing: false,
  syncedSoFar: 0,
  lastError: null,
};

export const feedEntryRanged: FeedEntry = {
  kind: "malware",
  cvssScore: null,
  patchedVersion: null,
  externalId: "GHSA-aaaa-bbbb-cccc",
  ecosystem: "npm",
  name: "evil-npm-pkg",
  versionRange: ">=1.0.0 <2.0.0",
  rawRange: ">= 1.0.0, < 2.0.0",
  severity: "critical",
  summary: "Malware in evil-npm-pkg",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  updatedAt: "2026-11-15T00:00:00.000Z",
};

export const feedEntryAll: FeedEntry = {
  kind: "malware",
  cvssScore: null,
  patchedVersion: null,
  externalId: "GHSA-dddd-eeee-ffff",
  ecosystem: "pypi",
  name: "bad-py-pkg",
  versionRange: null,
  rawRange: ">= 0",
  severity: "high",
  summary: "Malicious code in bad-py-pkg",
  url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
  updatedAt: "2026-11-14T12:00:00.000Z",
};

export function feedPage(items: FeedEntry[], overrides: Partial<Page<FeedEntry>> = {}): Page<FeedEntry> {
  return { items, total: items.length, page: 1, limit: 50, ...overrides };
}

export const feedEntryCve: FeedEntry = {
  kind: "cve",
  cvssScore: 9.8,
  patchedVersion: "4.17.21",
  externalId: "GHSA-gggg-hhhh-iiii",
  ecosystem: "npm",
  name: "lodash",
  versionRange: "<4.17.21",
  rawRange: "< 4.17.21",
  severity: "critical",
  summary: "Command injection in lodash",
  url: "https://github.com/advisories/GHSA-gggg-hhhh-iiii",
  updatedAt: "2026-11-15T06:00:00.000Z",
};
