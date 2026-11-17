import { summarySchema } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createCompositeIndex, createFeedIndex } from "../feed/index.ts";
import { createEntryIndex } from "../matcher.ts";
import { createRepositories } from "../repositories/index.ts";
import { DAY, HOUR, MINUTE } from "../test/clock.ts";
import { fakeNode, FakeFeedClient, type FakeNodeInput } from "../test/feed.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  patchFinding,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { listEntries, putEntry } from "../test/v2.ts";

afterEach(cleanupTestApps);

const RANGE = "< 2.0.0";
const FRESH = "2026-11-12T00:30:00Z"; // 첫 동기화(2026-11-12T00:00Z) 뒤의 증분 동기화가 받는 시각

const cve = (input: Partial<FakeNodeInput> = {}) =>
  fakeNode({ ghsa: "GHSA-cvee-cvee-0001", name: "lib", range: RANGE, severity: "HIGH", cvssV3: 9.1, summary: "Vuln in lib", ...input });
const malware = (input: Partial<FakeNodeInput> = {}) =>
  fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "lib", range: RANGE, severity: "CRITICAL", summary: "Malware in lib", ...input });

async function setup(options: { cve?: unknown[]; malware?: unknown[]; cveMinScore?: number } = {}) {
  const client = new FakeFeedClient(options.malware ?? []);
  client.setNodes(options.cve ?? [], "cve");
  const t = createTestApp({ feedClient: client });
  await putSettings(t, options.cveMinScore === undefined ? {} : { cveMinScore: options.cveMinScore });
  t.github.setRepos([
    {
      name: "svc",
      files: {
        "package.json": pkgJson({ dependencies: { lib: "^1.0.0" } }),
        "package-lock.json": npmLockV3({ lib: "1.5.0" }, { lib: "^1.0.0" }),
      },
    },
  ]);
  await syncFeed(t);
  return { t, client };
}

async function syncFeed(t: TestApp): Promise<void> {
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
}

async function nextScan(t: TestApp) {
  t.clock.advance(MINUTE);
  return runScan(t);
}

async function summary(t: TestApp) {
  const res = await t.request("GET", "/api/summary");
  return summarySchema.parse(res.json);
}

describe("같은 (종류, 이름, 범위)의 malware 와 cve", () => {
  it("[SI-95] 같은 스캔에서 두 분류가 함께 일치하면 검출 1건, source=feed, 즉시 메일 1통, openCount 1, cveOpenCount 0 (행 순서와 무관)", async () => {
    // A: malware 행이 먼저(id 가 작다)
    const a = await setup({ cve: [cve()], malware: [malware()] });
    await runScan(a.t);
    // B: cve 행이 먼저
    const b = await setup({ cve: [cve()] });
    b.t.clock.advance(HOUR);
    b.client.setNodes([malware({ updatedAt: FRESH })]);
    await syncFeed(b.t);
    await runScan(b.t);

    for (const { t } of [a, b]) {
      const findings = await allFindings(t);
      expect(findings.map((f) => [f.source, f.status])).toEqual([["feed", "open"]]);
      expect(t.mailer.sent).toHaveLength(1);
      expect(t.mailer.sentText()).toContain("lib@1.5.0");
      expect(await summary(t)).toMatchObject({ openCount: 1, cveOpenCount: 0 });
      const entries = await listEntries(t);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ source: "feed", externalId: "GHSA-evil-evil-0001", severity: "critical", enabled: true });
      expect(entries[0]?.reason).toContain("Malware in lib");
    }
  });

  it("[SI-96] cve 항목이 먼저 있고 나중에 malware 행이 동기화되면 다음 스캔에서 승격되고 메일이 간다 (같은 검출 행)", async () => {
    const { t, client } = await setup({ cve: [cve()] });
    await runScan(t);
    const [before] = await allFindings(t);
    expect(before).toMatchObject({ source: "cve", notifiedAt: null });
    expect(t.mailer.sent).toHaveLength(0);

    t.clock.advance(HOUR);
    client.setNodes([malware({ updatedAt: FRESH })]);
    await syncFeed(t);
    await runScan(t);

    const findings = await allFindings(t);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: before?.id, source: "feed", status: "open", severity: "critical" });
    expect(findings[0]?.reason).toContain("Malware in lib");
    expect(t.mailer.sent).toHaveLength(1);
    expect(await summary(t)).toMatchObject({ openCount: 1, cveOpenCount: 0 });
    expect(await listEntries(t)).toHaveLength(1);
  });

  it("[SI-97] cve 항목이 기준 미만으로 휴면 중이어도 malware 행은 일치한다", async () => {
    const { t, client } = await setup({ cve: [cve({ cvssV3: 9.1 })] });
    await runScan(t);
    await putSettings(t, { cveMinScore: 9.5 });
    await nextScan(t);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);

    t.clock.advance(HOUR);
    client.setNodes([malware({ updatedAt: FRESH })]);
    await syncFeed(t);
    await nextScan(t);

    const open = (await allFindings(t)).filter((f) => f.status === "open");
    expect(open.map((f) => f.source)).toEqual(["feed"]);
    expect(t.mailer.sent).toHaveLength(1);
    expect(await listEntries(t)).toHaveLength(1);
  });

  it("[SI-98] 사용자가 끈 cve 항목이 있어도 malware 행은 일치한다 (항목은 켜지고 feed 로 승격)", async () => {
    const { t, client } = await setup({ cve: [cve()] });
    await runScan(t);
    const [entry] = await listEntries(t);
    if (!entry) throw new Error("항목이 없습니다");
    await putEntry(t, entry.id, { name: entry.name, versionRange: entry.versionRange, reason: entry.reason, enabled: false });

    t.clock.advance(HOUR);
    client.setNodes([malware({ updatedAt: FRESH })]);
    await syncFeed(t);
    await nextScan(t);

    expect((await allFindings(t)).filter((f) => f.status === "open").map((f) => f.source)).toEqual(["feed"]);
    expect(await listEntries(t)).toEqual([expect.objectContaining({ id: entry.id, source: "feed", enabled: true })]);
  });

  it("[SI-99] 사용자가 끈 cve 항목은 그 뒤 cve 행으로는 다시 살아나지 않는다 (malware 만 예외)", async () => {
    const { t } = await setup({ cve: [cve()] });
    await runScan(t);
    const [entry] = await listEntries(t);
    if (!entry) throw new Error("항목이 없습니다");
    await putEntry(t, entry.id, { name: entry.name, versionRange: entry.versionRange, reason: entry.reason, enabled: false });

    await nextScan(t);

    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);
    expect(await listEntries(t)).toEqual([expect.objectContaining({ source: "cve", enabled: false })]);
  });

  it("[SI-100] cve 권고 1건이 철회돼도 같은 범위의 다른 cve 권고가 남아 있으면 항목을 끄지 않고 external_id 를 남은 권고로 바꾼다", async () => {
    const { t, client } = await setup({
      cve: [
        cve({ ghsa: "GHSA-high-high-0001", cvssV3: 9, updatedAt: "2026-11-01T00:00:02Z" }),
        cve({ ghsa: "GHSA-lowl-lowl-0001", cvssV3: 8.2, updatedAt: "2026-11-01T00:00:01Z" }),
      ],
    });
    await runScan(t);
    const [entry] = await listEntries(t);
    if (!entry?.externalId) throw new Error("항목이 없습니다");
    const gone = entry.externalId;
    const other = gone === "GHSA-high-high-0001" ? "GHSA-lowl-lowl-0001" : "GHSA-high-high-0001";

    t.clock.advance(8 * DAY);
    client.setNodes([cve({ ghsa: other, cvssV3: 8.2 })], "cve");
    await syncFeed(t);

    const [after] = await listEntries(t);
    expect(after).toMatchObject({ id: entry.id, enabled: true, externalId: other });
    expect(after?.reason).not.toContain("권고가 철회됨");
    await nextScan(t);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["open"]);
  });

  it("[SI-101] 철회로 남은 권고가 없으면(범위가 다른 권고만 남음) 항목은 꺼진다", async () => {
    const { t, client } = await setup({ cve: [cve()] });
    await runScan(t);

    t.clock.advance(8 * DAY);
    client.setNodes([cve({ ghsa: "GHSA-diff-diff-0001", range: "< 1.0.0" })], "cve");
    await syncFeed(t);

    expect((await listEntries(t))[0]).toMatchObject({ enabled: false });
  });
});

describe("무시한 검출과 기준 점수의 변경", () => {
  it("[SI-102] 기준을 올렸다 내려도 사용자가 무시한(ignored) cve 검출은 그대로 ignored 다", async () => {
    const { t } = await setup({ cve: [cve()] });
    await runScan(t);
    const [finding] = await allFindings(t);
    if (!finding) throw new Error("검출이 없습니다");
    await patchFinding(t, finding.id, "ignored");

    await putSettings(t, { cveMinScore: 9.5 });
    await nextScan(t);
    expect((await allFindings(t)).map((f) => [f.id, f.status])).toEqual([[finding.id, "ignored"]]);

    await putSettings(t, { cveMinScore: 8 });
    await nextScan(t);
    expect((await allFindings(t)).map((f) => [f.id, f.status])).toEqual([[finding.id, "ignored"]]);
    // 기준을 바꿔도 검출은 다음 스캔까지 그대로다(설정 저장은 검출을 건드리지 않는다)
  });
});

describe("대조 index 의 막힘(blocked)", () => {
  const rows = [
    { id: 1, ecosystem: "npm", name: "lib", versionRange: "<2.0.0", kind: "malware" as const },
    { id: 2, ecosystem: "npm", name: "lib", versionRange: "<2.0.0", kind: "cve" as const },
    { id: 3, ecosystem: "npm", name: "other", versionRange: null, kind: "cve" as const },
    { id: 4, ecosystem: "npm", name: "other", versionRange: null, kind: "malware" as const },
  ];
  const key = (name: string, range: string) => `npm\u0000${name}\u0000${range}`;

  it("[SI-103] cve 항목의 키는 cve 행만 막고, 그 밖의 항목(feed·manual)의 키는 두 분류를 모두 막는다", () => {
    const index = createFeedIndex(rows);
    const all = new Set([key("lib", "<2.0.0"), key("other", "")]);
    const nonCve = new Set([key("other", "")]); // lib 의 키는 cve 항목, other 의 키는 manual 항목

    const composite = createCompositeIndex(createEntryIndex([]), index, all, nonCve);

    expect(composite.match("npm", "lib").map((entry) => entry.id)).toEqual([-1]);
    expect(composite.match("npm", "other")).toEqual([]);
  });

  it("[SI-104] 네 번째 인자가 없으면 지금처럼 모든 행을 같은 집합으로 막는다", () => {
    const composite = createCompositeIndex(createEntryIndex([]), createFeedIndex(rows), new Set([key("lib", "<2.0.0")]));

    expect(composite.match("npm", "lib")).toEqual([]);
    expect(composite.match("npm", "other").map((entry) => entry.id)).toEqual([-3, -4]);
  });
});

describe("기준 판정의 범위 비교", () => {
  it("[SI-105] 표기가 달라도 뜻이 같은 범위(모든 버전: '' 와 >=0)면 기준을 통과한다", () => {
    const t = createTestApp();
    const repos = createRepositories(t.instance.db);
    repos.feed.upsert(
      [
        {
          kind: "cve",
          cvssScore: 9,
          externalId: "GHSA-same-same-0001",
          ecosystem: "npm",
          name: "alllib",
          versionRange: null,
          rawRange: ">= 0",
          severity: "high",
          summary: "s",
          url: "https://github.com/advisories/x",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      null,
    );
    const now = "2026-11-12T00:00:00.000Z";
    const entry = repos.blacklist.insert(
      { ecosystem: "npm", name: "alllib", versionRange: ">=0", reason: "r", severity: "high", enabled: true, expiresAt: null, source: "cve", externalId: "GHSA-same-same-0001" },
      now,
      "2026-11-12",
    );

    expect(repos.blacklist.cveEntryIdsMeeting(8)).toEqual(new Set([entry.id]));
    expect(repos.blacklist.cveEntryIdsMeeting(9.5)).toEqual(new Set());
    expect(repos.blacklist.cveEntryIdsMeeting(0)).toEqual(new Set());
  });
});
