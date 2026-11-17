import { blacklistListSchema, summarySchema } from "@pw/shared";
import { afterEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { fakeNode, FakeFeedClient, type FakeNodeInput } from "../test/feed.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  listFindings,
  patchFinding,
  putSettings,
  RECIPIENTS,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries, putEntry } from "../test/v2.ts";

afterEach(cleanupTestApps);

const files = (packages: Record<string, string>) => ({
  "package.json": pkgJson({ dependencies: Object.fromEntries(Object.keys(packages).map((name) => [name, "^1.0.0"])) }),
  "package-lock.json": npmLockV3(
    packages,
    Object.fromEntries(Object.keys(packages).map((name) => [name, "^1.0.0"])),
  ),
});

const cve = (input: Partial<FakeNodeInput> = {}) =>
  fakeNode({
    ghsa: "GHSA-cvee-cvee-0001",
    name: "lib",
    range: "< 2.0.0",
    severity: "HIGH",
    cvssV3: 9.1,
    patched: "2.0.0",
    summary: "Prototype pollution in lib",
    ...input,
  });
const malware = (input: Partial<FakeNodeInput> = {}) =>
  fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil", range: "= 1.5.0", summary: "Malware in evil", ...input });

/** feed 에 노드를 넣고 전체 동기화까지 끝낸 앱 */
async function setup(
  cveNodes: unknown[],
  options: { malwareNodes?: unknown[]; packages?: Record<string, string>; cveMinScore?: number } = {},
): Promise<{ t: TestApp; client: FakeFeedClient }> {
  const client = new FakeFeedClient(options.malwareNodes ?? []);
  client.setNodes(cveNodes, "cve");
  const t = createTestApp({ feedClient: client });
  await putSettings(t, options.cveMinScore === undefined ? {} : { cveMinScore: options.cveMinScore });
  t.github.setRepos([{ name: "svc", files: files(options.packages ?? { lib: "1.5.0" }) }]);
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  return { t, client };
}

async function nextScan(t: TestApp) {
  t.clock.advance(MINUTE);
  return runScan(t);
}

async function summary(t: TestApp) {
  const res = await t.request("GET", "/api/summary");
  expect(res.status, res.text).toBe(200);
  return summarySchema.parse(res.json);
}

describe("취약점(cve)의 대조", () => {
  it("[SI-40] 기준 이상이면 source=cve 항목과 검출이 생긴다 (사유 = 점수 + 요약 + 권고 id + 링크). 스캔의 신규 수에는 넣지 않는다", async () => {
    const { t } = await setup([cve()]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(scan.newFindingCount).toBe(0);
    const entries = await listEntries(t);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: "cve",
      externalId: "GHSA-cvee-cvee-0001",
      ecosystem: "npm",
      name: "lib",
      versionRange: "<2.0.0",
      severity: "high",
      enabled: true,
      reason: "[CVSS 9.1] Prototype pollution in lib (GHSA-cvee-cvee-0001) 출처: https://github.com/advisories/GHSA-cvee-cvee-0001",
    });
    const findings = await allFindings(t);
    expect(findings.map((f) => [f.packageName, f.version, f.status, f.source, f.severity, f.blacklistEntryId])).toEqual([
      ["lib", "1.5.0", "open", "cve", "high", entries[0]?.id],
    ]);
  });

  it("[SI-41] 기준 미만은 일치하지 않는다 (항목도 만들지 않는다). 점수가 기준과 같으면 일치한다", async () => {
    const { t } = await setup([cve({ cvssV3: 7.9 })], { cveMinScore: 8 });
    await runScan(t);
    expect(await listEntries(t)).toHaveLength(0);
    expect(await allFindings(t)).toHaveLength(0);

    const { t: equal } = await setup([cve({ cvssV3: 8 })], { cveMinScore: 8 });
    await runScan(equal);
    expect(await allFindings(equal)).toHaveLength(1);
  });

  it("[SI-42] 점수가 없는 권고는 등급이 critical 일 때만 일치한다", async () => {
    const { t } = await setup([cve({ cvssV3: null, severity: "CRITICAL" })]);
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.source)).toEqual(["cve"]);

    const { t: high } = await setup([cve({ cvssV3: null, severity: "HIGH" })]);
    await runScan(high);
    expect(await allFindings(high)).toHaveLength(0);
  });

  it("[SI-43] 기준을 올리면 기존 cve 검출이 resolve 되고, 내리면 다시 생긴다", async () => {
    const { t } = await setup([cve({ cvssV3: 9.1 })]);
    await runScan(t);
    const [first] = await allFindings(t);
    expect(first?.status).toBe("open");

    await putSettings(t, { cveMinScore: 9.5 });
    const raised = await nextScan(t);

    expect(raised.newFindingCount).toBe(0);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);
    expect((await summary(t)).cveOpenCount).toBe(0);
    expect(await listEntries(t)).toHaveLength(1); // 항목은 남는다

    await putSettings(t, { cveMinScore: 8 });
    await nextScan(t);

    const after = await allFindings(t);
    expect(after.map((f) => f.status).sort()).toEqual(["open", "resolved"]);
    expect(after.find((f) => f.status === "open")?.blacklistEntryId).toBe(first?.blacklistEntryId);
    expect(after.find((f) => f.status === "open")?.id).not.toBe(first?.id);
  });

  it("[SI-44] 취약점을 끄거나(기준 0) 외부 목록을 끄면 대조하지 않고 기존 cve 검출도 resolve 된다", async () => {
    const { t } = await setup([cve()]);
    await runScan(t);
    expect((await summary(t)).cveOpenCount).toBe(1);

    await putSettings(t, { cveMinScore: 0 });
    await nextScan(t);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);

    await putSettings(t, { cveMinScore: 8 });
    await nextScan(t);
    expect((await summary(t)).cveOpenCount).toBe(1);

    const off = await t.request("PUT", "/api/settings", {
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: RECIPIENTS,
      feedEnabled: false,
    });
    expect(off.status, off.text).toBe(200);
    await nextScan(t);
    expect((await summary(t)).cveOpenCount).toBe(0);
  });

  it("[SI-45] 사용자가 cve 항목을 끄면 resolve 되고 다시 살아나지 않는다", async () => {
    const { t } = await setup([cve()]);
    await runScan(t);
    const [entry] = await listEntries(t);
    if (!entry) throw new Error("항목이 없습니다");

    await putEntry(t, entry.id, { name: entry.name, versionRange: entry.versionRange, reason: entry.reason, enabled: false });
    await nextScan(t);

    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved"]);
    expect(await listEntries(t)).toHaveLength(1);
  });

  it("[SI-46] malware 와 cve 가 같은 패키지에 함께 일치하면 검출이 2건이다 (출처가 다르다)", async () => {
    const { t } = await setup([cve({ name: "lib" })], {
      malwareNodes: [malware({ name: "lib", range: "= 1.5.0" })],
      packages: { lib: "1.5.0" },
    });

    await runScan(t);

    const findings = await allFindings(t);
    expect(findings.map((f) => f.source).sort()).toEqual(["cve", "feed"]);
    expect(new Set(findings.map((f) => f.blacklistEntryId)).size).toBe(2);
    const summ = await summary(t);
    expect(summ).toMatchObject({ openCount: 1, cveOpenCount: 1, policyOpenCount: 0 });
  });

  it("[SI-47] 같은 범위의 권고가 여럿이면 항목은 1개이고, 점수가 낮은 권고 때문에 기준을 올려도 사라지지 않는다", async () => {
    const { t } = await setup(
      [
        cve({ ghsa: "GHSA-lowl-lowl-0001", cvssV3: 5, updatedAt: "2026-11-01T00:00:02Z" }),
        cve({ ghsa: "GHSA-high-high-0001", cvssV3: 9, updatedAt: "2026-11-01T00:00:01Z" }),
      ],
      { cveMinScore: 4 },
    );
    await runScan(t);
    expect(await listEntries(t)).toHaveLength(1);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["open"]);

    await putSettings(t, { cveMinScore: 8 });
    await nextScan(t);

    expect((await allFindings(t)).map((f) => f.status)).toEqual(["open"]);
    expect(await listEntries(t)).toHaveLength(1);
  });

  it("[SI-48] 외부 목록이 권고를 철회하면(전체 동기화 sweep) source=cve 항목만 꺼지고 그 검출은 resolve 된다. malware 항목은 그대로", async () => {
    const { t, client } = await setup([cve()], { malwareNodes: [malware({ name: "evil" })], packages: { lib: "1.5.0", evil: "1.5.0" } });
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.source).sort()).toEqual(["cve", "feed"]);

    t.clock.advance(8 * 24 * 60 * MINUTE);
    client.setNodes([cve({ ghsa: "GHSA-other-other-0001", name: "other", range: ">= 0" })], "cve");
    t.instance.services.feed.startSync();
    await t.instance.services.feed.waitForIdle();
    const entries = await listEntries(t);

    expect(entries.find((entry) => entry.source === "cve")).toMatchObject({ enabled: false });
    expect(entries.find((entry) => entry.source === "cve")?.reason).toContain("권고가 철회됨");
    expect(entries.find((entry) => entry.source === "feed")).toMatchObject({ enabled: true });
    expect((await allFindings(t)).filter((f) => f.source === "cve").map((f) => f.status)).toEqual(["resolved"]);
    expect((await allFindings(t)).filter((f) => f.source === "feed").map((f) => f.status)).toEqual(["open"]);
  });
});

describe("검출·요약·목록의 출처", () => {
  async function mixed() {
    const { t } = await setup([cve({ name: "lib" }), cve({ ghsa: "GHSA-cvee-cvee-0002", name: "lib2" })], {
      malwareNodes: [malware({ name: "evil" })],
      packages: { lib: "1.5.0", lib2: "1.5.0", evil: "1.5.0" },
    });
    await addEntry(t, { name: "manual-pkg", reason: "수동" });
    t.github.setRepos([{ name: "svc", files: files({ lib: "1.5.0", lib2: "1.5.0", evil: "1.5.0", "manual-pkg": "1.0.0" }) }]);
    await runScan(t);
    return t;
  }

  it("[SI-50] summary: openCount 는 cve 를 세지 않고, cveOpenCount 가 따로 센다. ignoredCount 의 뜻은 그대로(위험한 설정만 뺀 무시된 검출)", async () => {
    const t = await mixed();

    expect(await summary(t)).toMatchObject({ openCount: 2, cveOpenCount: 2, policyOpenCount: 0, ignoredCount: 0 });

    const cveFinding = (await listFindings(t, { source: "cve" })).items[0];
    if (!cveFinding) throw new Error("cve 검출이 없습니다");
    await patchFinding(t, cveFinding.id, "ignored");

    expect(await summary(t)).toMatchObject({ openCount: 2, cveOpenCount: 1, ignoredCount: 1 });
  });

  it("[SI-51] 검출 목록: source·excludeSource 필터와 응답의 source", async () => {
    const t = await mixed();

    const all = await listFindings(t);
    expect(all.items.map((f) => f.source).sort()).toEqual(["cve", "cve", "feed", "manual"]);
    expect((await listFindings(t, { source: "cve" })).items.map((f) => f.packageName).sort()).toEqual(["lib", "lib2"]);
    expect((await listFindings(t, { excludeSource: "cve" })).items.map((f) => f.source).sort()).toEqual(["feed", "manual"]);
    expect((await listFindings(t, { source: "feed" })).total).toBe(1);
    expect((await listFindings(t, { source: "cve", excludeSource: "cve" })).total).toBe(0);
    expect((await t.request("GET", "/api/findings?source=other")).status).toBe(400);
  });

  it("[SI-52] 블랙리스트 목록: excludeSource 로 cve 항목을 뺀다", async () => {
    const t = await mixed();

    const res = await t.request("GET", "/api/blacklist?excludeSource=cve");
    expect(res.status, res.text).toBe(200);
    const items = blacklistListSchema.parse(res.json).items;
    expect(items.map((entry) => entry.source).sort()).toEqual(["feed", "manual"]);
    expect((await listEntries(t, { source: "cve" })).map((entry) => entry.name).sort()).toEqual(["lib", "lib2"]);
  });

  it("[SI-53] 스캔의 repo 상태: cve 만 있는 repo 는 passed 이고 openFindingCount 에 세지 않는다", async () => {
    const { t } = await setup([cve()]);

    const scan = await runScan(t);

    const res = await t.request("GET", `/api/scans/${scan.id}/repos`);
    expect(res.status, res.text).toBe(200);
    const items = (res.json as { items: { repo: string; status: string; openFindingCount: number }[] }).items;
    expect(items.find((item) => item.repo === "svc")).toMatchObject({ status: "passed", openFindingCount: 0 });
  });
});

describe("메일", () => {
  it("[SI-60] 즉시 메일: cve 만 있으면 메일 0통이고 notifiedAt 은 null 로 남는다", async () => {
    const { t } = await setup([cve()]);

    await runScan(t);

    expect(t.mailer.attempts).toHaveLength(0);
    expect((await allFindings(t)).map((f) => f.notifiedAt)).toEqual([null]);
  });

  it("[SI-61] 즉시 메일: malware 와 cve 가 함께 새로 생기면 메일 1통에 malware 만 있고, cve 의 notifiedAt 은 null", async () => {
    const { t } = await setup([cve({ name: "lib" })], {
      malwareNodes: [malware({ name: "evil" })],
      packages: { lib: "1.5.0", evil: "1.5.0" },
    });

    await runScan(t);

    expect(t.mailer.sent).toHaveLength(1);
    const text = t.mailer.sentText();
    expect(text).toContain("신규 검출 1건");
    expect(text).toContain("evil@1.5.0");
    expect(text).not.toContain("lib@");
    expect(text).not.toContain("CVSS");
    const findings = await allFindings(t);
    expect(findings.find((f) => f.source === "feed")?.notifiedAt).not.toBeNull();
    expect(findings.find((f) => f.source === "cve")?.notifiedAt).toBeNull();
  });

  it("[SI-62] 일일 요약: cve 는 행이 아니라 끝의 1줄(취약점: 총 n건, 패키지 m개). 기존 검출의 행은 그대로", async () => {
    const { t } = await setup([cve({ name: "lib" }), cve({ ghsa: "GHSA-cvee-cvee-0002", name: "lib2" }), cve({ ghsa: "GHSA-cvee-cvee-0003", name: "lib2", range: "< 3.0.0" })], {
      malwareNodes: [malware({ name: "evil" })],
      packages: { lib: "1.5.0", lib2: "1.5.0", evil: "1.5.0" },
    });
    await runScan(t);
    t.mailer.clear();

    await t.instance.services.notifier.sendDigest();

    expect(t.mailer.sent).toHaveLength(1);
    const mail = t.mailer.sent[0];
    expect(mail?.subject).toContain("미해결 검출 1건");
    expect(mail?.text).toContain("evil@1.5.0");
    expect(mail?.text).not.toContain("lib@");
    expect(mail?.text).not.toContain("lib2@");
    expect(mail?.text.trimEnd().split("\n").at(-1)).toBe("취약점: 총 3건, 패키지 2개");
  });

  it("[SI-63] 일일 요약: 다른 검출이 없고 cve 만 있으면 보내지 않는다", async () => {
    const { t } = await setup([cve()]);
    await runScan(t);
    t.mailer.clear();

    await t.instance.services.notifier.sendDigest();

    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[SI-64] 수동 항목의 메일은 그대로다 (즉시 메일 1통, 일일 요약에 cve 줄 없음)", async () => {
    const t = createTestApp();
    await putSettings(t);
    await addEntry(t, { name: "manual-pkg", reason: "수동" });
    t.github.setRepos([{ name: "svc", files: files({ "manual-pkg": "1.0.0" }) }]);

    await runScan(t);
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sentText()).toContain("manual-pkg@1.0.0");
    t.mailer.clear();
    await t.instance.services.notifier.sendDigest();

    expect(t.mailer.sentText()).toContain("manual-pkg@1.0.0");
    expect(t.mailer.sentText()).not.toContain("취약점:");
  });
});
