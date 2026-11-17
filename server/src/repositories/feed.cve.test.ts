import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, createTestApp } from "../test/testApp.ts";
import { createRepositories } from "./index.ts";
import type { FeedWrite } from "./feed.ts";

afterEach(cleanupTestApps);

const row = (name: string, extra: Partial<FeedWrite>): FeedWrite => ({
  externalId: `GHSA-${name}-xxxx-xxxx`,
  ecosystem: "npm",
  name,
  versionRange: null,
  rawRange: ">= 0",
  severity: "high",
  summary: "s",
  url: "https://github.com/advisories/x",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...extra,
});

describe("feed 저장소의 분류(kind)", () => {
  function seeded() {
    const t = createTestApp();
    const repos = createRepositories(t.instance.db);
    repos.feed.upsert(
      [
        row("mal", { kind: "malware", severity: "critical" }),
        row("hi", { kind: "cve", cvssScore: 9.1 }),
        row("lo", { kind: "cve", cvssScore: 5.5 }),
        row("nocrit", { kind: "cve", cvssScore: null, severity: "critical" }),
        row("nohigh", { kind: "cve", cvssScore: null, severity: "high" }),
      ],
      null,
    );
    return repos;
  }

  it("[SI-92] index 의 행: malware 는 모두, cve 는 cveMeetsMinScore 가 true 인 것만 (기준 0 = cve 없음)", () => {
    const repos = seeded();
    const names = (min?: number) => [...repos.feed.iterateIndexRows(min)].map((item) => item.name).sort();

    expect(names()).toEqual(["mal"]);
    expect(names(0)).toEqual(["mal"]);
    expect(names(8)).toEqual(["hi", "mal", "nocrit"]);
    expect(names(5.5)).toEqual(["hi", "lo", "mal", "nocrit"]);
    expect(names(10)).toEqual(["mal", "nocrit"]);
  });

  it("[SI-93] count·countsByEcosystem·sweep·deleteByExternalId 는 분류의 범위 안에서만 동작한다", () => {
    const repos = seeded();

    expect(repos.feed.count()).toBe(5);
    expect(repos.feed.count("malware")).toBe(1);
    expect(repos.feed.count("cve")).toBe(4);
    expect(repos.feed.countsByEcosystem("cve")).toEqual({ npm: 4 });
    expect(repos.feed.countsByEcosystem("malware")).toEqual({ npm: 1 });

    // 같은 실행 id 를 쓰더라도 다른 분류의 행은 지우지 않는다
    repos.feed.upsert([row("mal", { kind: "malware", severity: "critical" })], "run-1");
    expect(repos.feed.sweep("malware", "run-1")).toBe(0);
    expect(repos.feed.count("cve")).toBe(4);
    repos.feed.upsert([row("hi", { kind: "cve", cvssScore: 9.1 })], "run-1");
    expect(repos.feed.sweep("cve", "run-1")).toBe(3);
    expect(repos.feed.count("malware")).toBe(1);
    expect(repos.feed.count("cve")).toBe(1);

    expect(repos.feed.deleteByExternalId("malware", "GHSA-hi-xxxx-xxxx")).toBe(0);
    expect(repos.feed.deleteByExternalId("cve", "GHSA-hi-xxxx-xxxx")).toBe(1);
  });

  it("[SI-94] 점수나 고쳐진 버전이 바뀌면 갱신으로 센다. 값이 같으면 센 수가 0", () => {
    const repos = seeded();

    expect(repos.feed.upsert([row("hi", { kind: "cve", cvssScore: 9.1 })], null)).toBe(0);
    expect(repos.feed.upsert([row("hi", { kind: "cve", cvssScore: 9.4 })], null)).toBe(1);
    expect(repos.feed.upsert([row("hi", { kind: "cve", cvssScore: 9.4, patchedVersion: "2.0.0" })], null)).toBe(1);
    expect(repos.feed.list({ kind: "cve", q: "hi", page: 1, limit: 10 }).items[0]).toMatchObject({
      cvssScore: 9.4,
      patchedVersion: "2.0.0",
    });
  });
});

describe("분류의 재분류 (GENERAL → MALWARE)", () => {
  it("[SI-108] 같은 권고가 다른 분류로 오면 kind 가 바뀌고, 다른 분류의 sweep 에 지워지지 않는다", () => {
    const t = createTestApp();
    const repos = createRepositories(t.instance.db);
    const base = row("re", { kind: "cve", cvssScore: 9 });
    repos.feed.upsert([base], "cve:run-1");
    expect(repos.feed.count("cve")).toBe(1);

    // malware 동기화가 같은 권고를 본다 → 분류가 바뀐다
    expect(repos.feed.upsert([row("re", { kind: "malware", cvssScore: null })], "run-m1")).toBe(1);
    expect(repos.feed.count("malware")).toBe(1);
    expect(repos.feed.count("cve")).toBe(0);

    // 이어지는 cve 전체 동기화(그 권고를 더 이상 주지 않는다)는 malware 행을 지우지 않는다
    repos.feed.upsert([row("other", { kind: "cve", cvssScore: 9 })], "cve:run-2");
    expect(repos.feed.sweep("cve", "cve:run-2")).toBe(0);
    expect(repos.feed.count("malware")).toBe(1);
    // malware 의 다음 전체 동기화가 계속 보는 한 남는다 (지웠다 다시 생기는 반복이 없다)
    repos.feed.upsert([row("re", { kind: "malware", cvssScore: null })], "run-m2");
    expect(repos.feed.sweep("malware", "run-m2")).toBe(0);
    expect([...repos.feed.iterateIndexRows(8)].map((item) => item.name).sort()).toEqual(["other", "re"]);
  });
});
