import { afterEach, describe, expect, it } from "vitest";
import { MINUTE } from "./test/clock.ts";
import { pkgJson } from "./test/repoFixtures.ts";
import {
  cleanupTestApps,
  createTestApp,
  getScan,
  getSettings,
  putSettings,
  waitForScans,
} from "./test/testApp.ts";

afterEach(cleanupTestApps);

describe("서버 재시작 보정 (A-7)", () => {
  it("[A-7] 재시작 때 running 으로 남은 스캔은 failed(\"서버 재시작\")가 되고 새 스캔을 시작할 수 있다", async () => {
    const first = createTestApp();
    await putSettings(first);
    first.github.setRepos([{ name: "api", files: { "package.json": pkgJson() } }]);
    const gate = first.github.pause("getTree", "api");
    const started = await first.request("POST", "/api/scans");
    expect(started.status, started.text).toBe(202);
    const running = (started.json as { id: number }).id;
    await gate.waitReached();

    // 프로세스가 죽은 것처럼 첫 앱을 닫지 않고 같은 DB 로 다시 시작한다.
    const second = createTestApp({ dbPath: first.dbPath, github: first.github });
    second.clock.advance(MINUTE);

    expect(await getScan(second, running)).toMatchObject({
      status: "failed",
      error: "서버 재시작",
      finishedAt: expect.any(String),
    });
    const next = await second.request("POST", "/api/scans");
    expect(next.status, next.text).toBe(202);
    await waitForScans(second);
  });
});

describe("설정 초기값 env (D-28)", () => {
  it("[D-28] 키별로 검증·정규화해서 넣고, 잘못된 키는 경고 후 기본값을 쓴다", async () => {
    const t = createTestApp({
      initialSettings: {
        org: " My-Org ",
        scanIntervalHours: "0",
        digestTime: "07:30",
        recipients: "a@example.com, ,b@example.com,a@example.com",
      },
    });

    expect(await getSettings(t)).toMatchObject({
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "07:30",
      recipients: ["a@example.com", "b@example.com"],
    });
    expect(t.logger.texts("warn").some((text) => text.includes("SCAN_INTERVAL_HOURS"))).toBe(true);
  });

  it("[D-28] 이미 저장된 키는 env 로 덮어쓰지 않는다 (첫 실행에만 적용)", async () => {
    const first = createTestApp({ initialSettings: { org: "first-org" } });
    await putSettings(first, { org: "saved-org", scanIntervalHours: 6 });
    await first.close();

    const second = createTestApp({
      dbPath: first.dbPath,
      initialSettings: { org: "env-org", scanIntervalHours: "12" },
    });

    expect(await getSettings(second)).toMatchObject({ org: "saved-org", scanIntervalHours: 6 });
  });
});
