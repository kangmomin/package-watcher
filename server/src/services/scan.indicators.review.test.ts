import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pkgJson } from "../test/repoFixtures.ts";
import { allFindings, cleanupTestApps, createTestApp, putSettings, runScan, type TestApp } from "../test/testApp.ts";
import { addEntry, putEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const entry = (ecosystem: string, name: string) =>
  addEntry(t, { ecosystem, name, versionRange: null, reason: `${ecosystem} 흔적` });

const pad = (n: number): string => String(n).padStart(3, "0");

describe("결정성 (상한 100건)", () => {
  it("[SC-70] path 는 tree 순서와 무관하게 정렬한 앞의 100건이다", async () => {
    await entry("path", "big-*.dat");
    const files: Record<string, string> = {};
    for (let i = 149; i >= 0; i -= 1) files[`d/big-${pad(i)}.dat`] = "";
    t.github.setRepos([{ name: "svc", files }]);

    await runScan(t);

    const got = (await allFindings(t)).map((f) => f.filePath).sort();
    expect(got).toEqual(Array.from({ length: 100 }, (_, i) => `d/big-${pad(i)}.dat`));
  });

  it("[SC-71] content 는 받는 순서와 무관하게 경로를 정렬한 앞의 100건이다", async () => {
    await entry("content", "needle-string");
    const files: Record<string, string> = {};
    for (let i = 149; i >= 0; i -= 1) files[`.github/workflows/w${pad(i)}.yml`] = "# needle-string\n";
    t.github.setRepos([{ name: "svc", files }]);

    await runScan(t);

    const got = (await allFindings(t)).map((f) => f.filePath).sort();
    expect(got).toEqual(Array.from({ length: 100 }, (_, i) => `.github/workflows/w${pad(i)}.yml`));
  });

  it("[SC-72] branch 는 반환 순서와 무관하게 정렬한 앞의 100건이다", async () => {
    await entry("branch", "bot/*");
    t.github.setRepos([{ name: "svc", files: { "package.json": pkgJson() } }]);
    t.github.setBranches("svc", Array.from({ length: 130 }, (_, i) => `bot/${pad(129 - i)}`));

    await runScan(t);

    const got = (await allFindings(t)).map((f) => f.filePath).sort();
    expect(got).toEqual(Array.from({ length: 100 }, (_, i) => `refs/heads/bot/${pad(i)}`));
  });
});

describe("링크", () => {
  it("[SC-73] lone surrogate 가 든 경로도 스캔이 성공하고 링크는 repo 루트다", async () => {
    await entry("path", "*lone-x*");
    t.github.setRepos([{ name: "svc", files: { "dir/lone-x\ud800.js": "" } }]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect((await allFindings(t))[0]?.htmlUrl).toBe("https://github.com/my-org/svc");
  });

  it("[SC-74] refs/heads/ 로 시작하는 실제 파일(path 검출)의 링크는 blob 이다", async () => {
    await entry("path", "refs/heads/x");
    t.github.setRepos([{ name: "svc", files: { "refs/heads/x": "" } }]);

    await runScan(t);

    expect((await allFindings(t))[0]?.htmlUrl).toBe("https://github.com/my-org/svc/blob/HEAD/refs/heads/x");
  });
});

describe("흔적만 볼 수 있는 repo", () => {
  const PYPROJECT = `[project]\nname = "app"\nversion = "1"\ndependencies = ["evil-py==1.0"]\n`;

  it("[SC-75] 다른 종류는 path 항목의 켬·끔과 무관하게 원래대로 건너뛰고, 그 종류의 기존 검출은 resolve 된다", async () => {
    await entry("pypi", "evil-py");
    t.github.setRepos([{ name: "svc", files: { "pyproject.toml": PYPROJECT } }]);
    await runScan(t);
    expect((await allFindings(t)).map((f) => `${f.ecosystem}:${f.status}`)).toEqual(["pypi:open"]);

    // 선언 파일 없이 lock 과 흔적 파일만 남는다
    const trace = await entry("path", ".ci-*.sh");
    t.github.setFiles("svc", { "poetry.lock": `[[package]]\nname = "evil-py"\nversion = "1.0"\n`, ".ci-a.sh": "" });
    await runScan(t);
    const on = (await allFindings(t)).map((f) => `${f.ecosystem}:${f.status}`).sort();
    expect(on).toEqual(["path:open", "pypi:resolved"]);
    expect(t.github.callsOf("getFile")).toHaveLength(1); // 첫 스캔의 pyproject 뿐

    await putEntry(t, trace.id, { ecosystem: "path", name: ".ci-*.sh", versionRange: null, reason: "r", enabled: false });
    await runScan(t);
    expect((await allFindings(t)).map((f) => `${f.ecosystem}:${f.status}`).sort()).toEqual([
      "path:resolved",
      "pypi:resolved",
    ]);
  });
});
