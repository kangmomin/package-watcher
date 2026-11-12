import { afterEach, describe, expect, it } from "vitest";
import { MINUTE } from "./test/clock.ts";
import { pkgJson } from "./test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  patchFinding,
  putSettings,
  runScan,
} from "./test/testApp.ts";
import { addEntry, getEntry } from "./test/v2.ts";

afterEach(cleanupTestApps);

const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });
const clean = () => pkgJson({ dependencies: { "safe-lib": "^2.0.0" } });

describe("서버 시작 보정 — 비활성 항목 정리와 severity 맞춤 (CT-19)", () => {
  it("[CT-19] 서버가 꺼져 있는 동안 만료된 항목의 활성 검출(open·ignored)은 시작할 때 resolved 가 된다", async () => {
    const first = createTestApp();
    await putSettings(first, { scanIntervalHours: 168 });
    const entry = await addEntry(first, { ...EVIL, expiresAt: "2026-11-12" });
    first.github.setRepos([
      { name: "api", files: { "package.json": withEvil() } },
      { name: "web", files: { "package.json": withEvil() } },
    ]);
    await runScan(first);
    await patchFinding(first, findOne(await allFindings(first), { repo: "web" }).id, "ignored");
    await first.close();

    // 2일 뒤(KST 11-14)에 다시 시작한다. tick 은 아직 없다.
    const restartedAt = "2026-11-14T00:00:00.000Z";
    const second = createTestApp({ dbPath: first.dbPath, github: first.github, now: restartedAt });

    expect(await getEntry(second, entry.id)).toMatchObject({ enabled: true, isExpired: true });
    expect((await allFindings(second)).map((item) => [item.status, item.resolvedAt])).toEqual([
      ["resolved", restartedAt],
      ["resolved", restartedAt],
    ]);
  });

  it("[CT-19] 꺼진 항목에 남은 활성 검출(이전 버전 이미지가 만든 것)은 시작할 때 resolved 가 된다", async () => {
    const first = createTestApp();
    await putSettings(first, { scanIntervalHours: 168 });
    const off = await addEntry(first, EVIL);
    const on = await addEntry(first, { name: "other-pkg", reason: "켜진 항목" });
    first.github.setRepos([
      {
        name: "api",
        files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "^1.0.0", "other-pkg": "^1.0.0" } }) },
      },
    ]);
    await runScan(first);
    // API 로는 만들 수 없는 상태(꺼진 항목 + 활성 검출)라서 DB 를 직접 고친다.
    first.instance.db.prepare("UPDATE blacklist_entries SET enabled = 0 WHERE id = ?").run(off.id);
    await first.close();

    const second = createTestApp({ dbPath: first.dbPath, github: first.github });

    const items = await allFindings(second);
    expect(findOne(items, { packageName: "evil-pkg" })).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-11-12T00:00:00.000Z",
      blacklistEntryId: off.id,
    });
    expect(findOne(items, { packageName: "other-pkg" })).toMatchObject({
      status: "open",
      resolvedAt: null,
      blacklistEntryId: on.id,
    });
  });

  it("[CT-19] medium 으로 남은 활성 검출 + high 항목인 DB 로 재시작 → 활성 검출은 high 가 되고 resolved 행은 그대로다", async () => {
    const first = createTestApp();
    await putSettings(first, { scanIntervalHours: 168 });
    const entry = await addEntry(first, { ...EVIL, severity: "high" });
    first.github.setRepos([
      { name: "api", files: { "package.json": withEvil() } },
      { name: "web", files: { "package.json": withEvil() } },
      { name: "old", files: { "package.json": withEvil() } },
    ]);
    await runScan(first);
    await patchFinding(first, findOne(await allFindings(first), { repo: "web" }).id, "ignored");
    first.github.setFiles("old", { "package.json": clean() });
    first.clock.advance(MINUTE);
    await runScan(first);
    expect((await allFindings(first)).map((item) => item.severity)).toEqual(["high", "high", "high"]);
    // 이전 버전 이미지로 내려 둔 동안 생긴 검출은 DB 기본값 medium 으로 남는다.
    first.instance.db.prepare("UPDATE findings SET severity = 'medium'").run();
    await first.close();

    const second = createTestApp({ dbPath: first.dbPath, github: first.github });

    expect((await getEntry(second, entry.id)).severity).toBe("high");
    const items = await allFindings(second);
    expect(findOne(items, { repo: "api" })).toMatchObject({ status: "open", severity: "high" });
    expect(findOne(items, { repo: "web" })).toMatchObject({ status: "ignored", severity: "high" });
    expect(findOne(items, { repo: "old" })).toMatchObject({ status: "resolved", severity: "medium" });
  });
});
