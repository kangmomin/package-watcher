import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTE } from "../test/clock.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  findOne,
  getSettings,
  RECIPIENTS,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, putEntry, putSettingsV2 } from "../test/v2.ts";

const deps = (...packages: string[]) =>
  pkgJson({ dependencies: Object.fromEntries(packages.map((name) => [name, "^1.0.0"])) });

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

afterEach(cleanupTestApps);

async function nextScan() {
  t.clock.advance(MINUTE);
  return runScan(t);
}

async function sendDigest(): Promise<string> {
  t.mailer.clear();
  await t.instance.services.notifier.sendDigest();
  return t.mailer.sentText();
}

describe("즉시 메일의 심각도 임계값 (notifyMinSeverity)", () => {
  it("[v2-AC-06][CT-21] notifyMinSeverity = high, 신규 low 1건 + high 1건 → 즉시 메일 1통에 high 1건만, low 의 notifiedAt 은 null, 일일 요약에는 2건", async () => {
    await putSettingsV2(t, { notifyMinSeverity: "high" });
    await addEntry(t, { name: "low-pkg", reason: "낮음", severity: "low" });
    await addEntry(t, { name: "high-pkg", reason: "높음", severity: "high" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("low-pkg", "high-pkg") } }]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]?.to).toEqual(RECIPIENTS);
    const mail = t.mailer.sentText();
    expect(mail).toContain("high-pkg@");
    expect(mail).not.toContain("low-pkg");
    const items = await allFindings(t);
    expect(findOne(items, { packageName: "high-pkg" }).notifiedAt).toBe(t.clock.iso());
    expect(findOne(items, { packageName: "low-pkg" })).toMatchObject({ status: "open", notifiedAt: null });

    const digest = await sendDigest();
    expect(t.mailer.sent).toHaveLength(1);
    expect(digest).toContain("high-pkg@");
    expect(digest).toContain("low-pkg@");
  });

  it("[CT-21] 신규 검출이 모두 임계값 미만이면 즉시 메일을 보내지 않고 notifiedAt 은 null 로 남는다 (일일 요약에는 포함)", async () => {
    await putSettingsV2(t, { notifyMinSeverity: "critical" });
    await addEntry(t, { name: "high-pkg", reason: "높음", severity: "high" });
    await addEntry(t, { name: "med-pkg", reason: "기본값" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("high-pkg", "med-pkg") } }]);

    const scan = await runScan(t);

    expect(scan.newFindingCount).toBe(2);
    expect(t.mailer.attempts).toHaveLength(0);
    expect((await allFindings(t)).map((item) => item.notifiedAt)).toEqual([null, null]);
    const digest = await sendDigest();
    expect(digest).toContain("high-pkg@");
    expect(digest).toContain("med-pkg@");
  });

  it("[v2-EC-16][CT-21] notifyMinSeverity 를 high → low 로 낮추면 빠졌던 open 검출이 다음 스캔 종료 메일에 포함된다", async () => {
    await putSettingsV2(t, { notifyMinSeverity: "high" });
    await addEntry(t, { name: "low-pkg", reason: "낮음", severity: "low" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("low-pkg") } }]);
    await runScan(t);
    expect(t.mailer.attempts).toHaveLength(0);
    expect((await allFindings(t)).map((item) => item.notifiedAt)).toEqual([null]);

    const lowered = await putSettingsV2(t, { notifyMinSeverity: "low" });
    expect(lowered.notifyMinSeverity).toBe("low");
    // 설정 저장만으로는 메일이 나가지 않는다. 다음 스캔 종료 때 보낸다.
    expect(t.mailer.attempts).toHaveLength(0);

    const scan = await nextScan();

    expect(scan.newFindingCount).toBe(0);
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sentText()).toContain("low-pkg@");
    expect((await allFindings(t)).map((item) => item.notifiedAt)).toEqual([t.clock.iso()]);

    // 한 번 보낸 검출은 다시 보내지 않는다.
    t.mailer.clear();
    await nextScan();
    expect(t.mailer.attempts).toHaveLength(0);
  });

  it("[CT-21] 항목의 severity 를 임계값 이상으로 올리면 notifiedAt 이 null 이던 open 검출이 다음 스캔 종료 메일에 포함된다", async () => {
    await putSettingsV2(t, { notifyMinSeverity: "high" });
    const entry = await addEntry(t, { name: "med-pkg", reason: "기본값" });
    t.github.setRepos([{ name: "api", files: { "package.json": deps("med-pkg") } }]);
    await runScan(t);
    expect(t.mailer.attempts).toHaveLength(0);

    await putEntry(t, entry.id, { name: "med-pkg", versionRange: null, reason: "기본값", severity: "critical" });
    expect(t.mailer.attempts).toHaveLength(0);
    const scan = await nextScan();

    expect(scan.newFindingCount).toBe(0);
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sentText()).toContain("[critical][npm] package.json: med-pkg@^1.0.0");
    expect((await allFindings(t))[0]).toMatchObject({ severity: "critical", notifiedAt: t.clock.iso() });
  });
});

describe("메일 본문 (즉시 메일·일일 요약 공용 렌더러)", () => {
  it("[CT-21] 행 앞에 `[심각도][종류]` 가 붙고 정렬은 심각도 → repo 순이다 (repo 제목은 repo 가 바뀔 때마다)", async () => {
    await putSettingsV2(t);
    expect((await getSettings(t)).notifyMinSeverity).toBe("low");
    await addEntry(t, { name: "crit-pkg", reason: "치명", severity: "critical" });
    await addEntry(t, { name: "high-pkg", reason: "높음", severity: "high" });
    await addEntry(t, { name: "low-pkg", reason: "낮음", severity: "low" });
    t.github.setRepos([
      { name: "aaa-repo", files: { "package.json": deps("low-pkg", "crit-pkg") } },
      { name: "mmm-repo", files: { "package.json": deps("high-pkg") } },
    ]);

    await runScan(t);

    expect(t.mailer.sent).toHaveLength(1);
    const text = t.mailer.sent[0]?.text ?? "";
    const rows = [
      "[critical][npm] package.json: crit-pkg@^1.0.0",
      "[high][npm] package.json: high-pkg@^1.0.0",
      "[low][npm] package.json: low-pkg@^1.0.0",
    ];
    for (const row of rows) expect(text).toContain(row);
    const positions = rows.map((row) => text.indexOf(row));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // critical(aaa-repo) → high(mmm-repo) → low(aaa-repo): aaa-repo 제목이 2번 나온다.
    const titles = text.split("\n").map((line) => line.trim());
    expect(titles.filter((line) => line === "[aaa-repo]")).toHaveLength(2);
    expect(titles.filter((line) => line === "[mmm-repo]")).toHaveLength(1);
    expect(titles.indexOf("[aaa-repo]")).toBeLessThan(titles.indexOf("[mmm-repo]"));
    expect(titles.indexOf("[mmm-repo]")).toBeLessThan(titles.lastIndexOf("[aaa-repo]"));

    const digest = await sendDigest();
    for (const row of rows) expect(digest).toContain(row);
    const digestPositions = rows.map((row) => digest.indexOf(row));
    expect(digestPositions).toEqual([...digestPositions].sort((a, b) => a - b));
  });

  it("[CT-21] 같은 심각도 안에서는 repo → 파일 경로 → 패키지 순이다", async () => {
    await putSettingsV2(t);
    await addEntry(t, { name: "b-pkg", reason: "x", severity: "high" });
    await addEntry(t, { name: "a-pkg", reason: "x", severity: "high" });
    t.github.setRepos([
      { name: "zzz-repo", files: { "package.json": deps("a-pkg") } },
      { name: "aaa-repo", files: { "sub/package.json": deps("a-pkg"), "package.json": deps("b-pkg", "a-pkg") } },
    ]);

    await runScan(t);

    const text = t.mailer.sent[0]?.text ?? "";
    const rows = [
      "[high][npm] package.json: a-pkg@^1.0.0",
      "[high][npm] package.json: b-pkg@^1.0.0",
      "[high][npm] sub/package.json: a-pkg@^1.0.0",
    ];
    const positions = rows.map((row) => text.indexOf(row));
    expect(positions.every((position) => position >= 0), text).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // zzz-repo 의 행은 aaa-repo 의 모든 행 뒤에 온다.
    expect(text.lastIndexOf("[high][npm] package.json: a-pkg@^1.0.0")).toBeGreaterThan(positions[2] ?? -1);
  });

  it("[CT-21] 201건 중 critical 1건이 이름순 마지막 repo 에 있어도 본문(200행)에 포함되고 잘리는 것은 낮은 심각도다", async () => {
    await putSettingsV2(t);
    await addEntry(t, { name: "bulk-pkg", reason: "대량", severity: "low" });
    await addEntry(t, { name: "crit-pkg", reason: "치명", severity: "critical" });
    const bulkFiles = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `p${String(index + 1).padStart(3, "0")}/package.json`,
        deps("bulk-pkg"),
      ]),
    );
    t.github.setRepos([
      { name: "aaa-repo", files: bulkFiles },
      { name: "zzz-repo", files: { "package.json": deps("crit-pkg") } },
    ]);

    const scan = await runScan(t);

    expect(scan).toMatchObject({ status: "success", newFindingCount: 201 });
    expect(t.mailer.sent).toHaveLength(1);
    const text = t.mailer.sent[0]?.text ?? "";
    expect(text).toContain("[critical][npm] package.json: crit-pkg@^1.0.0");
    expect(text).toContain("외 1건");
    expect(text.split("\n").filter((line) => line.includes("bulk-pkg@"))).toHaveLength(199);
    // 본문에서 잘린 검출도 발송 대상이므로 notifiedAt 이 기록된다.
    expect((await allFindings(t)).every((item) => item.notifiedAt !== null)).toBe(true);
  });
});
