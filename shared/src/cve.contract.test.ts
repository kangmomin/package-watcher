import { describe, expect, it } from "vitest";
import {
  CVE_MIN_SCORE_DEFAULT,
  ENTRY_SOURCES,
  FEED_KIND_SOURCE,
  blacklistQuerySchema,
  cveMeetsMinScore,
  feedEntriesQuerySchema,
  feedEntrySchema,
  feedStatusSchema,
  findingSchema,
  findingsQuerySchema,
  settingsInputSchema,
  settingsSchema,
  summarySchema,
  vulnerabilitiesQuerySchema,
  vulnerabilityDetailQuerySchema,
  vulnerabilityDetailSchema,
  vulnerabilityGroupSchema,
} from "./contract.ts";
import * as fx from "./fixtures.ts";

const KIND_STATUS = { entryCount: 10, skippedCount: 0, lastSyncedAt: null, fullSyncDone: false, lastError: null };
const CVE_ENTRY = {
  kind: "cve",
  cvssScore: 9.1,
  patchedVersion: "0.35.0",
  externalId: "GHSA-5cgq-3rg8-m6cv",
  ecosystem: "go",
  name: "golang.org/x/crypto",
  versionRange: "<v0.35.0",
  rawRange: "< 0.35.0",
  severity: "critical",
  summary: "auth bypass",
  url: "https://github.com/advisories/GHSA-5cgq-3rg8-m6cv",
  updatedAt: "2026-11-16T00:14:17.000Z",
};
const GROUP = {
  ecosystem: "go",
  packageName: "golang.org/x/crypto",
  maxScore: 9.1,
  severity: "critical",
  advisoryCount: 2,
  repoCount: 38,
  findingCount: 57,
  hasDirect: true,
  patchedVersions: ["0.35.0", "0.31.0"],
};

describe("[SI-01] 취약점(CVE)의 계약", () => {
  it("출처에 cve 가 있고, 외부 목록의 분류마다 출처가 정해져 있다", () => {
    expect(ENTRY_SOURCES).toEqual(["manual", "feed", "cve"]);
    expect(FEED_KIND_SOURCE).toEqual({ malware: "feed", cve: "cve" });
  });

  it("검출에 출처가 있다", () => {
    expect(fx.findingOpenDirect.source).toBe("manual");
    expect(findingSchema.safeParse({ ...fx.findingOpenDirect, source: "cve" }).success).toBe(true);
    const { source: _source, ...withoutSource } = fx.findingOpenDirect;
    expect(findingSchema.safeParse(withoutSource).success).toBe(false);
  });

  it("검출과 블랙리스트의 목록은 출처로 거르거나 뺄 수 있다", () => {
    expect(findingsQuerySchema.parse({ source: "cve" }).source).toBe("cve");
    expect(findingsQuerySchema.parse({ excludeSource: "cve" }).excludeSource).toBe("cve");
    expect(findingsQuerySchema.parse({}).excludeSource).toBeUndefined();
    expect(findingsQuerySchema.safeParse({ excludeSource: "x" }).success).toBe(false);
    expect(blacklistQuerySchema.parse({ excludeSource: "cve" }).excludeSource).toBe("cve");
  });

  it("summary 는 취약점을 따로 센다", () => {
    expect(fx.summaryDefault.cveOpenCount).toBe(0);
    const { cveOpenCount: _count, ...without } = fx.summaryDefault;
    expect(summarySchema.safeParse(without).success).toBe(false);
  });

  it("설정의 cveMinScore: 0 또는 4~10 (소수 1자리), 응답에는 필수, 입력에서는 생략할 수 있다", () => {
    expect(CVE_MIN_SCORE_DEFAULT).toBe(8);
    expect(fx.settingsDefault.cveMinScore).toBe(8);
    const { cveMinScore: _score, ...without } = fx.settingsDefault;
    expect(settingsSchema.safeParse(without).success).toBe(false);
    const input = { org: "my-org", scanIntervalHours: 24, digestTime: "09:00", recipients: [] };
    expect(settingsInputSchema.parse(input).cveMinScore).toBeUndefined();
    for (const ok of [0, 4, 7.5, 8, 9.1, 10]) {
      expect(settingsInputSchema.safeParse({ ...input, cveMinScore: ok }).success, String(ok)).toBe(true);
    }
    for (const bad of [-1, 0.5, 3.9, 10.1, 8.25, "8", null]) {
      expect(settingsInputSchema.safeParse({ ...input, cveMinScore: bad }).success, String(bad)).toBe(false);
    }
  });

  it("기준의 판정: 점수가 없으면 critical 만, 0 이면 아무것도 대조하지 않는다", () => {
    expect(cveMeetsMinScore(8, "high", 8)).toBe(true);
    expect(cveMeetsMinScore(7.9, "high", 8)).toBe(false);
    expect(cveMeetsMinScore(null, "critical", 8)).toBe(true);
    expect(cveMeetsMinScore(null, "high", 8)).toBe(false);
    expect(cveMeetsMinScore(10, "critical", 0)).toBe(false);
    expect(cveMeetsMinScore(null, "critical", 0)).toBe(false);
  });

  it("외부 목록의 항목에 분류, 점수, 고쳐진 버전이 있다", () => {
    expect(feedEntrySchema.safeParse(CVE_ENTRY).success).toBe(true);
    expect(feedEntrySchema.safeParse({ ...CVE_ENTRY, kind: "malware", cvssScore: null, patchedVersion: null }).success).toBe(true);
    expect(feedEntrySchema.safeParse({ ...CVE_ENTRY, cvssScore: 10.1 }).success).toBe(false);
    expect(feedEntrySchema.safeParse({ ...CVE_ENTRY, kind: "other" }).success).toBe(false);
    const { kind: _kind, ...withoutKind } = CVE_ENTRY;
    expect(feedEntrySchema.safeParse(withoutKind).success).toBe(false);
    expect(feedEntriesQuerySchema.parse({ kind: "cve" }).kind).toBe("cve");
    expect(feedEntriesQuerySchema.safeParse({ kind: "x" }).success).toBe(false);
  });

  it("외부 목록의 상태에 분류별 상태가 있다", () => {
    const status = {
      enabled: true,
      byKind: { malware: { ...KIND_STATUS, fullSyncDone: true }, cve: KIND_STATUS },
      entryCount: 20,
      byEcosystem: { npm: 20 },
      skippedCount: 0,
      lastSyncedAt: null,
      fullSyncDone: false,
      syncing: true,
      syncedSoFar: 400,
      lastError: null,
    };
    expect(feedStatusSchema.safeParse(status).success).toBe(true);
    expect(feedStatusSchema.safeParse({ ...status, byKind: { malware: KIND_STATUS } }).success).toBe(false);
  });

  it("취약점의 묶음과 상세", () => {
    expect(vulnerabilityGroupSchema.safeParse(GROUP).success).toBe(true);
    expect(vulnerabilityGroupSchema.safeParse({ ...GROUP, maxScore: null, patchedVersions: [] }).success).toBe(true);
    expect(vulnerabilityGroupSchema.safeParse({ ...GROUP, patchedVersions: Array(11).fill("1.0.0") }).success).toBe(false);
    const detail = {
      ecosystem: "go",
      packageName: "golang.org/x/crypto",
      advisories: [
        {
          blacklistEntryId: 200,
          externalId: "GHSA-5cgq-3rg8-m6cv",
          cvssScore: 9.1,
          severity: "critical",
          summary: "auth bypass",
          url: "https://github.com/advisories/GHSA-5cgq-3rg8-m6cv",
          versionRange: "<v0.35.0",
          patchedVersion: "0.35.0",
          findingCount: 1,
        },
      ],
      findings: [{ ...fx.findingOpenDirect, source: "cve" }],
      findingsTotal: 1,
    };
    expect(vulnerabilityDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("취약점 목록의 query: 기본 page 1, limit 50, 최대 200. 상세는 종류와 이름이 필수", () => {
    expect(vulnerabilitiesQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 });
    expect(vulnerabilitiesQuerySchema.parse({ directOnly: "true", q: " grpc " })).toMatchObject({ directOnly: true, q: "grpc" });
    expect(vulnerabilitiesQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(vulnerabilityDetailQuerySchema.parse({ ecosystem: "npm", name: "@scope/pkg" }).name).toBe("@scope/pkg");
    expect(vulnerabilityDetailQuerySchema.safeParse({ ecosystem: "npm" }).success).toBe(false);
    expect(vulnerabilityDetailQuerySchema.safeParse({ ecosystem: "npm", name: "  " }).success).toBe(false);
  });
});
