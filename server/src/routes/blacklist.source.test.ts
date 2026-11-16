import { afterEach, describe, expect, it } from "vitest";
import { exportRequest } from "../test/bulk.ts";
import { fakeNode, FakeFeedClient } from "../test/feed.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import { cleanupTestApps, createTestApp, expectApiError, putSettings, runScan, type TestApp } from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

afterEach(cleanupTestApps);

/** feed 항목 1개가 스캔에서 일치해서 생긴 항목이 있는 앱 */
async function appWithFeedEntry(): Promise<TestApp> {
  const t = createTestApp({ feedClient: new FakeFeedClient([fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil" })]) });
  await putSettings(t);
  t.github.setRepos([
    { name: "svc", files: { "package.json": pkgJson({ dependencies: { evil: "^1" } }), "package-lock.json": npmLockV3({ evil: "1.0.0" }, { evil: "^1" }) } },
  ]);
  t.instance.services.feed.startSync();
  await t.instance.services.feed.waitForIdle();
  await runScan(t);
  return t;
}

describe("블랙리스트 항목의 출처", () => {
  it("[SE-90] 사용자가 만든 항목(POST)은 source=manual, externalId=null", async () => {
    const t = createTestApp();

    const created = await addEntry(t, { name: "evil-pkg", reason: "악성" });

    expect(created).toMatchObject({ source: "manual", externalId: null });
  });

  it("[SE-91] 가져오기로 만든 항목과 내장 검사(policy seed)도 manual 이다", async () => {
    const t = createTestApp({ seedPolicy: true });
    const res = await t.request("POST", "/api/blacklist/import", {
      format: "json",
      content: JSON.stringify({ version: 1, items: [{ name: "imported", reason: "r" }] }),
      dryRun: false,
    });
    expect(res.status, res.text).toBe(200);

    const entries = await listEntries(t);

    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((entry) => entry.source === "manual" && entry.externalId === null)).toBe(true);
  });

  it("[SE-92] ?source=feed|manual 로 거른다. 잘못된 값은 400", async () => {
    const t = await appWithFeedEntry();
    await addEntry(t, { name: "manual-pkg", reason: "수동" });

    expect((await listEntries(t)).map((entry) => entry.name)).toEqual(["evil", "manual-pkg"]);
    expect((await listEntries(t, { source: "feed" })).map((entry) => entry.name)).toEqual(["evil"]);
    expect((await listEntries(t, { source: "manual" })).map((entry) => entry.name)).toEqual(["manual-pkg"]);
    expectApiError(await t.request("GET", "/api/blacklist?source=other"), 400, "VALIDATION_ERROR");
  });

  it("[SE-93] 내보내기의 파일 형식은 그대로(출처 열 없음). 내보낸 feed 항목을 다시 가져오면 기존 항목과 합쳐지고 출처는 유지된다", async () => {
    const t = await appWithFeedEntry();

    const exported = await exportRequest(t, { format: "json" });
    expect(exported.status, exported.text).toBe(200);
    const file = JSON.parse(exported.text) as { items: Record<string, unknown>[] };
    expect(Object.keys(file.items[0] ?? {}).sort()).toEqual(
      ["ecosystem", "enabled", "expiresAt", "name", "reason", "severity", "versionRange"].sort(),
    );

    const imported = await t.request("POST", "/api/blacklist/import", { format: "json", content: exported.text, dryRun: false });
    expect(imported.json).toMatchObject({ applied: true, created: 0, unchanged: 1 });
    const entries = await listEntries(t);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: "feed", externalId: "GHSA-evil-evil-0001" });
  });

  it("[SE-94] feed 항목도 사용자가 고치면 출처는 그대로 feed 이다", async () => {
    const t = await appWithFeedEntry();
    const [entry] = await listEntries(t);
    expect(entry).toBeDefined();
    if (!entry) return;

    const res = await t.request("PUT", `/api/blacklist/${entry.id}`, { name: entry.name, versionRange: null, reason: "사유를 고침" });

    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ source: "feed", externalId: "GHSA-evil-evil-0001", reason: "사유를 고침" });
  });
});
