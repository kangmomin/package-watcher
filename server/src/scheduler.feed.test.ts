import { afterEach, describe, expect, it } from "vitest";
import { fakeNode, FakeFeedClient } from "./test/feed.ts";
import { npmLockV3, pkgJson } from "./test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  listScans,
  putSettings,
  waitForScans,
  type TestApp,
} from "./test/testApp.ts";

afterEach(cleanupTestApps);

const T = "2026-11-12T00:00:00.000Z";
const FILES = {
  "package.json": pkgJson({ dependencies: { evil: "^1" } }),
  "package-lock.json": npmLockV3({ evil: "1.0.0" }, { evil: "^1" }),
};

async function appDue(client: FakeFeedClient, feedWaitMs?: number): Promise<TestApp> {
  const t = createTestApp({ now: T, feedClient: client, feedWaitMs });
  t.github.setRepos([{ name: "svc", files: FILES }]);
  await putSettings(t, { scanIntervalHours: 6 });
  t.clock.set("2026-11-12T06:00:30.000Z");
  return t;
}

describe("스케줄러와 외부 목록", () => {
  it("[SE-100] 자동 스캔은 증분 동기화를 기다린 뒤 시작한다: 같은 tick 의 스캔이 방금 받은 항목을 쓴다", async () => {
    const client = new FakeFeedClient([fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil" })]);
    const t = await appDue(client);

    await t.instance.scheduler.tick();
    await waitForScans(t);

    expect(client.calls).toEqual([null]);
    expect((await listScans(t)).items[0]).toMatchObject({ trigger: "scheduled", newFindingCount: 1 });
    expect((await allFindings(t)).map((finding) => finding.packageName)).toEqual(["evil"]);
  });

  it("[SE-101] 동기화가 끝나지 않으면 최대 feedWaitMs 만 기다리고 스캔을 시작한다 (동기화는 계속된다)", async () => {
    const client = new FakeFeedClient([fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil" })]);
    const gate = client.pauseNext();
    const t = await appDue(client, 30);

    await t.instance.scheduler.tick();
    await waitForScans(t);

    expect((await listScans(t)).items[0]).toMatchObject({ trigger: "scheduled", status: "success", newFindingCount: 0 });
    expect(t.instance.services.feed.getStatus().syncing).toBe(true);
    gate.release();
    await t.instance.services.feed.waitForIdle();
  });

  it("[SE-102] 수동 스캔(POST /api/scans)은 동기화를 기다리지도 시작하지도 않는다", async () => {
    const client = new FakeFeedClient([fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil" })]);
    const t = await appDue(client);

    const res = await t.request("POST", "/api/scans");
    expect(res.status).toBe(202);
    await waitForScans(t);

    expect(client.calls).toHaveLength(0);
  });

  it("[SE-103] feed 가 꺼져 있으면 동기화하지 않고 바로 스캔한다", async () => {
    const client = new FakeFeedClient([fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil" })]);
    const t = await appDue(client);
    await t.request("PUT", "/api/settings", { org: "my-org", scanIntervalHours: 6, digestTime: "09:00", recipients: [], feedEnabled: false });

    await t.instance.scheduler.tick();
    await waitForScans(t);

    expect(client.calls).toHaveLength(0);
    expect((await listScans(t)).total).toBe(1);
  });

  it("[SE-104] 동기화가 실패해도 스캔은 한다 (lastError 만 남는다)", async () => {
    const client = new FakeFeedClient([fakeNode({ ghsa: "GHSA-evil-evil-0001", name: "evil" })]);
    client.failures.set(1, new Error("GitHub API 오류 (502): bad gateway"));
    const t = await appDue(client);

    await t.instance.scheduler.tick();
    await waitForScans(t);

    expect((await listScans(t)).items[0]).toMatchObject({ trigger: "scheduled", status: "success" });
    expect(t.instance.services.feed.getStatus().lastError).toContain("502");
  });
});
