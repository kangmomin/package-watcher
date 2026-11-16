import { scanReposPageSchema, type Page, type ScanRepo } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pkgJson, npmLockV3 } from "../test/repoFixtures.ts";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, putEntry } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
});

afterEach(cleanupTestApps);

const entry = (ecosystem: string, name: string) =>
  addEntry(t, { ecosystem, name, versionRange: null, reason: `${ecosystem} 흔적` });

async function repoRows(scanId: number): Promise<Page<ScanRepo>> {
  const res = await t.request("GET", `/api/scans/${scanId}/repos?limit=200`);
  expect(res.status, res.text).toBe(200);
  return scanReposPageSchema.parse(res.json);
}

const rowOf = (page: Page<ScanRepo>, repo: string): ScanRepo => {
  const found = page.items.find((item) => item.repo === repo);
  if (!found) throw new Error(`repo 행이 없습니다: ${repo}`);
  return found;
};

const WF = ".github/workflows/ci.yml";
const paths = async (): Promise<string[]> => (await allFindings(t)).map((f) => f.filePath).sort();

describe("path 검출", () => {
  it("[SC-10] node_modules 안의 경로도 일치하고 파일을 받지 않는다(요청 0)", async () => {
    await entry("path", "node_modules/x/router_init.js");
    await entry("path", "src/other-file.js");
    t.github.setRepos([
      { name: "svc", files: { "node_modules/x/router_init.js": "a", "src/ok.js": "b" } },
    ]);

    await runScan(t);

    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      ecosystem: "path",
      filePath: "node_modules/x/router_init.js",
      packageName: "node_modules/x/router_init.js",
      version: "",
      dependencyType: "direct",
    });
    expect(t.github.callsOf("getFile")).toHaveLength(0);
    expect(t.github.callsOf("listBranches")).toHaveLength(0);
  });

  it("[SC-11] 패턴에 / 가 없으면 파일 이름(마지막 조각)과도 비교하고 있으면 전체 경로만 비교한다", async () => {
    await entry("path", "router_init.js");
    await entry("path", "lib/setup.js");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "a/b/router_init.js": "1",
          "router_init.js": "2",
          "lib/setup.js": "3",
          "other/lib/setup.js": "4",
        },
      },
    ]);

    await runScan(t);

    expect(await paths()).toEqual(["a/b/router_init.js", "lib/setup.js", "router_init.js"]);
  });

  it("[SC-12] * 패턴은 전체 경로에 일치하고 / 없는 패턴은 파일 이름에도 일치한다", async () => {
    await entry("path", ".ci-*.sh");
    await entry("path", ".github/workflows/*-loot.yml");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "scripts/.ci-run.sh": "1",
          ".ci-x.sh": "2",
          "scripts/ci-run.sh": "3",
          ".github/workflows/wfx-loot.yml": "4",
          ".github/workflows/ok.yml": "5",
        },
      },
    ]);

    await runScan(t);

    expect(await paths()).toEqual([".ci-x.sh", ".github/workflows/wfx-loot.yml", "scripts/.ci-run.sh"]);
  });

  it("[SC-13] 항목 1개의 검출은 repo 당 100건으로 자르고 경고를 1줄 남긴다", async () => {
    await entry("path", "big-*.dat");
    const files: Record<string, string> = {};
    for (let i = 0; i < 150; i += 1) files[`d/big-${i}.dat`] = String(i);
    t.github.setRepos([{ name: "svc", files }]);

    await runScan(t);

    expect(await allFindings(t)).toHaveLength(100);
    expect(t.logger.texts("warn").filter((text) => text.includes("big-*.dat"))).toHaveLength(1);
  });

  it("[SC-14] 긴 경로는 자르지 않고 그대로 저장한다", async () => {
    await entry("path", "*deep-trace.js");
    const long = `${"d/".repeat(100)}deep-trace.js`;
    t.github.setRepos([{ name: "svc", files: { [long]: "x" } }]);

    await runScan(t);

    expect((await allFindings(t))[0]?.filePath).toBe(long);
  });

  it("[SC-15] 의존성 파일이 없는 repo 도 skipped 가 아니고 흔적 검출이 다음 스캔에서 resolve 되지 않는다", async () => {
    await entry("path", ".ci-*.sh");
    t.github.setRepos([
      { name: "trace", files: { ".ci-a.sh": "x" } },
      { name: "clean", files: { "README.md": "x" } },
      { name: "empty", files: {} },
    ]);

    const first = await runScan(t);
    const second = await runScan(t);

    for (const scan of [first, second]) {
      const rows = await repoRows(scan.id);
      expect(rowOf(rows, "trace")).toMatchObject({ status: "issue", fileCount: 0 });
      expect(rowOf(rows, "clean")).toMatchObject({ status: "passed", fileCount: 0 });
      expect(rowOf(rows, "empty")).toMatchObject({ status: "skipped" });
    }
    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]?.status).toBe("open");
  });

  it("[SC-16] 활성 path 항목이 없으면 의존성 파일이 없는 repo 는 skipped 다", async () => {
    t.github.setRepos([{ name: "clean", files: { "README.md": "x" } }]);
    await entry("npm", "evil-pkg");

    const scan = await runScan(t);

    expect(rowOf(await repoRows(scan.id), "clean")).toMatchObject({ status: "skipped" });
  });

  it("[SC-17] 항목을 끄거나 삭제하면 검출이 resolved 가 된다", async () => {
    const off = await entry("path", ".ci-*.sh");
    const del = await entry("path", "router_init.js");
    t.github.setRepos([{ name: "svc", files: { ".ci-a.sh": "1", "router_init.js": "2" } }]);
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.status)).toEqual(["open", "open"]);

    await putEntry(t, off.id, { ecosystem: "path", name: ".ci-*.sh", versionRange: null, reason: "r", enabled: false });
    expect((await t.request("DELETE", `/api/blacklist/${del.id}`)).status).toBe(204);
    await runScan(t);

    expect((await allFindings(t)).map((f) => f.status)).toEqual(["resolved", "resolved"]);
  });
});

describe("대규모 입력", () => {
  it("[SC-18] 경로 3만 개 × path 항목 300개(패턴 50개)도 빠르게 끝난다", async () => {
    for (let i = 0; i < 250; i += 1) await entry("path", `trace/exact-${i}.js`);
    for (let i = 0; i < 50; i += 1) await entry("path", `*-pat${i}.sh`);
    const files: Record<string, string> = {};
    for (let i = 0; i < 30_000; i += 1) files[`src/m${i % 300}/f${i}.ts`] = "";
    files["trace/exact-7.js"] = "";
    files["x/a-pat3.sh"] = "";
    t.github.setRepos([{ name: "svc", files }]);

    const started = Date.now();
    await runScan(t);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await paths()).toEqual(["trace/exact-7.js", "x/a-pat3.sh"]);
  });
});

describe("content 검출", () => {
  const NEEDLE = "needle-pkg-name";

  it("[SC-20] 받은 파일(package.json, lock, workflow)에서 대소문자를 무시하고 찾고 같은 파일을 2번 받지 않는다", async () => {
    await entry("content", "Needle-Pkg-Name");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({ dependencies: { [NEEDLE]: "^1.0.0" } }),
          "package-lock.json": npmLockV3({ [NEEDLE]: "1.0.0" }, { [NEEDLE]: "^1.0.0" }),
          [WF]: `name: ci\n# ${NEEDLE.toUpperCase()}\njobs: {}\n`,
          "README.md": NEEDLE,
        },
      },
    ]);

    await runScan(t);

    expect(await paths()).toEqual([WF, "package-lock.json", "package.json"]);
    expect(await allFindings(t)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ecosystem: "content", packageName: "Needle-Pkg-Name", version: "", dependencyType: "direct" }),
      ]),
    );
    const sha = t.github.callsOf("getFile").map((call) => call.arg);
    expect(new Set(sha).size).toBe(sha.length);
    expect(sha).toHaveLength(3);
  });

  it("[SC-21] content 항목이 있으면 다른 활성 항목이 없어도 보조 파일을 받고, 없으면 받지 않는다", async () => {
    t.github.setRepos([
      {
        name: "svc",
        files: { [WF]: "run: curl http://193.32.204.199/x\n", Dockerfile: "FROM node\nRUN echo 193.32.204.199\n" },
      },
    ]);
    await entry("go", "github.com/unrelated/mod");
    await runScan(t);
    expect(t.github.callsOf("getFile")).toHaveLength(0);

    await entry("content", "193.32.204.199");
    await runScan(t);

    expect(await paths()).toEqual([WF, "Dockerfile"]);
  });

  it("[SC-22] 다른 종류의 선언 파일은 그 종류가 활성일 때만 받고, 받았다면 검사한다", async () => {
    await entry("content", "evil-host.example");
    t.github.setRepos([{ name: "svc", files: { "go.mod": "module x\n// evil-host.example\n" } }]);
    await runScan(t);
    expect(await allFindings(t)).toHaveLength(0);
    expect(t.github.callsOf("getFile")).toHaveLength(0);

    await entry("go", "github.com/unrelated/mod");
    await runScan(t);

    expect(await paths()).toEqual(["go.mod"]);
  });

  it("[SC-23] 파싱에 실패하는 보조 파일도 원문으로 검사한다", async () => {
    await entry("content", "evil-host.example");
    t.github.setRepos([{ name: "svc", files: { [WF]: "a: [unclosed\n  evil-host.example: {\n" } }]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect(await paths()).toEqual([WF]);
  });

  it("[SC-24] 8MB 를 넘는 파일은 건너뛰고 경고한다", async () => {
    await entry("content", "evil-host.example");
    t.github.setRepos([
      { name: "svc", files: { [WF]: `#${"x".repeat(8 * 1024 * 1024)}\nevil-host.example\n` } },
    ]);

    await runScan(t);

    expect(await allFindings(t)).toHaveLength(0);
    expect(t.logger.texts("warn").some((text) => text.includes(WF))).toBe(true);
  });

  it("[SC-25] 항목이 여러 개여도 일치한 항목마다 1건이고 항목을 끄면 resolved 가 된다", async () => {
    const a = await entry("content", "evil-host.example");
    await entry("content", "193.32.204.199");
    await entry("content", "no-such-string");
    t.github.setRepos([{ name: "svc", files: { [WF]: "x: EVIL-HOST.example 193.32.204.199\n" } }]);
    await runScan(t);
    expect((await allFindings(t)).map((f) => f.packageName).sort()).toEqual(["193.32.204.199", "evil-host.example"]);

    await putEntry(t, a.id, { ecosystem: "content", name: "evil-host.example", versionRange: null, reason: "r", enabled: false });
    await runScan(t);

    const byName = Object.fromEntries((await allFindings(t)).map((f) => [f.packageName, f.status]));
    expect(byName).toEqual({ "evil-host.example": "resolved", "193.32.204.199": "open" });
  });

  it("[SC-26] 의존성 파일이 없고 보조 파일도 없는 repo 는 content 만으로는 skipped 다", async () => {
    await entry("content", "evil-host.example");
    t.github.setRepos([{ name: "docs", files: { "README.md": "evil-host.example" } }]);

    const scan = await runScan(t);

    expect(rowOf(await repoRows(scan.id), "docs")).toMatchObject({ status: "skipped" });
  });
});

describe("branch 검출", () => {
  it("[SC-30] 이름과 패턴에 일치하고 filePath 는 refs/heads/<이름> 이며 링크는 /tree/ 다", async () => {
    await entry("branch", "wfx-docs");
    await entry("branch", "chore/*");
    t.github.setRepos([{ name: "svc", files: { "package.json": pkgJson() } }]);
    t.github.setBranches("svc", ["main", "wfx-docs", "chore/a+b c", "feature/x"]);

    await runScan(t);

    const found = await allFindings(t);
    expect(found.map((f) => f.filePath).sort()).toEqual(["refs/heads/chore/a+b c", "refs/heads/wfx-docs"]);
    expect(found.find((f) => f.packageName === "wfx-docs")).toMatchObject({
      ecosystem: "branch",
      version: "",
      dependencyType: "direct",
      htmlUrl: "https://github.com/my-org/svc/tree/wfx-docs",
    });
    expect(found.find((f) => f.packageName === "chore/*")?.htmlUrl).toBe(
      "https://github.com/my-org/svc/tree/chore/a%2Bb%20c",
    );
  });

  it("[SC-31] 활성 branch 항목이 없으면 listBranches 를 호출하지 않고 있으면 repo 마다 1번 호출한다", async () => {
    t.github.setRepos([
      { name: "a", files: { "package.json": pkgJson() } },
      { name: "b", files: { "package.json": pkgJson() } },
    ]);
    await entry("npm", "evil-pkg");
    await runScan(t);
    expect(t.github.callsOf("listBranches")).toHaveLength(0);

    await entry("branch", "wfx-docs");
    await runScan(t);

    expect(t.github.callsOf("listBranches").map((call) => call.repo).sort()).toEqual(["a", "b"]);
  });

  it("[SC-32] 브랜치 조회 실패는 그 repo 의 실패다", async () => {
    await entry("branch", "wfx-docs");
    t.github.setRepos([
      { name: "bad", files: { "package.json": pkgJson() } },
      { name: "good", files: { "package.json": pkgJson() } },
    ]);
    t.github.failBranches("bad", new Error("GitHub API 오류 (500): boom"));

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos).toEqual([{ repo: "bad", error: expect.stringContaining("500") }]);
  });

  it("[SC-33] 의존성 파일이 없는 repo 도 skipped 가 아니다", async () => {
    await entry("branch", "wfx-docs");
    t.github.setRepos([{ name: "docs", files: { "README.md": "x" } }]);
    t.github.setBranches("docs", ["main", "wfx-docs"]);

    const first = await runScan(t);
    await runScan(t);

    expect(rowOf(await repoRows(first.id), "docs")).toMatchObject({ status: "issue" });
    const found = await allFindings(t);
    expect(found).toHaveLength(1);
    expect(found[0]?.status).toBe("open");
  });

  it("[SC-34] 항목 1개의 검출은 repo 당 100건으로 자른다", async () => {
    await entry("branch", "bot/*");
    t.github.setRepos([{ name: "svc", files: { "package.json": pkgJson() } }]);
    t.github.setBranches("svc", Array.from({ length: 130 }, (_, i) => `bot/${i}`));

    await runScan(t);

    expect(await allFindings(t)).toHaveLength(100);
  });

  it("[SC-35] 브랜치가 사라지거나 항목이 꺼지면 resolved 가 된다", async () => {
    await entry("branch", "wfx-docs");
    t.github.setRepos([{ name: "svc", files: { "package.json": pkgJson() } }]);
    t.github.setBranches("svc", ["wfx-docs"]);
    await runScan(t);
    expect((await allFindings(t))[0]?.status).toBe("open");

    t.github.setBranches("svc", ["main"]);
    await runScan(t);

    expect((await allFindings(t))[0]?.status).toBe("resolved");
  });
});
