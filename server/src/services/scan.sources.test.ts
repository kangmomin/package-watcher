import { scanReposPageSchema, type Page, type ScanRepo } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pkgJson } from "../test/repoFixtures.ts";
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

const entry = (ecosystem: string, name: string, versionRange: string | null = null) =>
  addEntry(t, { ecosystem, name, versionRange, reason: `${ecosystem} 악성` });

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

const workflow = (...runs: string[]) =>
  `name: ci\njobs:\n  build:\n    steps:\n${runs.map((run) => `      - run: ${JSON.stringify(run)}\n`).join("")}`;

const WF = ".github/workflows/ci.yml";

describe("go.sum", () => {
  const goMod = (...requires: string[]) =>
    `module example.com/app\n\ngo 1.22\n\nrequire (\n${requires.map((line) => `\t${line}\n`).join("")})\n`;

  it("[SA-60] go.sum 의 간접 모듈도 검출하고 go.mod 에 선언된 이름은 direct 다", async () => {
    await entry("go", "github.com/evil/mod", "<v1.5.0");
    await entry("go", "github.com/evil/indirect");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "go.mod": goMod("github.com/evil/mod v1.2.0"),
          "go.sum":
            "github.com/evil/mod v1.2.0 h1:a=\ngithub.com/evil/mod v1.2.0/go.mod h1:b=\n" +
            "github.com/evil/indirect v0.0.1 h1:c=\n",
        },
      },
    ]);

    const scan = await runScan(t);

    const found = Object.fromEntries(
      (await allFindings(t)).map((item) => [item.packageName, [item.filePath, item.version, item.dependencyType]]),
    );
    expect(found).toEqual({
      "github.com/evil/mod": ["go.sum", "v1.2.0", "direct"],
      "github.com/evil/indirect": ["go.sum", "v0.0.1", "transitive"],
    });
    expect(rowOf(await repoRows(scan.id), "svc")).toMatchObject({ status: "issue", fileCount: 2 });
  });

  it("[SA-61] go.sum 에 정확한 버전이 없으면 go.mod 의 선언도 검사하고, go.mod 만 있는 repo 는 그대로다", async () => {
    await entry("go", "github.com/evil/mod", "=v1.2.0");
    t.github.setRepos([
      { name: "no-sum-entry", files: { "go.mod": goMod("github.com/evil/mod v1.2.0"), "go.sum": "a.com/x v1.0.0 h1:a=\n" } },
      { name: "only-mod", files: { "go.mod": goMod("github.com/evil/mod v1.2.0") } },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items.map((item) => `${item.repo}:${item.filePath}`).sort()).toEqual([
      "no-sum-entry:go.mod",
      "only-mod:go.mod",
    ]);
  });
});

describe("pom.xml", () => {
  it("[SA-62] pom.xml 의 의존성을 maven 으로 검출한다", async () => {
    await entry("maven", "com.evil:lib", "[1.0,2.0)");
    t.github.setRepos([
      {
        name: "java",
        files: {
          "pom.xml": `<project><properties><v>1.5</v></properties><dependencies><dependency><groupId>com.evil</groupId><artifactId>lib</artifactId><version>\${v}</version></dependency></dependencies></project>`,
        },
      },
    ]);

    const scan = await runScan(t);

    expect(await allFindings(t)).toMatchObject([
      { ecosystem: "maven", filePath: "pom.xml", packageName: "com.evil:lib", version: "1.5", dependencyType: "direct" },
    ]);
    expect(rowOf(await repoRows(scan.id), "java")).toMatchObject({ status: "issue", fileCount: 1 });
  });
});

describe("보조 파일 검출", () => {
  it("[SA-70] workflow 의 npx 정확한 버전은 범위와 비교한다", async () => {
    await entry("npm", "evil-cli", "<2.0.0");
    t.github.setRepos([
      { name: "hit", files: { [WF]: workflow("npx -y evil-cli@1.0.0") } },
      { name: "miss", files: { [WF]: workflow("npx -y evil-cli@2.0.0") } },
    ]);

    const scan = await runScan(t);

    expect(await allFindings(t)).toMatchObject([
      { repo: "hit", ecosystem: "npm", filePath: WF, packageName: "evil-cli", version: "1.0.0", dependencyType: "direct" },
    ]);
    const rows = await repoRows(scan.id);
    expect(rowOf(rows, "hit")).toMatchObject({ status: "issue", fileCount: 1 });
    expect(rowOf(rows, "miss")).toMatchObject({ status: "passed", fileCount: 1 });
  });

  it("[SA-71] 버전 없는 실행은 범위가 없는 항목에만 일치한다", async () => {
    await entry("npm", "all-bad");
    await entry("npm", "ranged", "<2.0.0");
    t.github.setRepos([
      { name: "svc", files: { [WF]: workflow("npx all-bad", "npx ranged", "npx ranged@latest") } },
    ]);

    await runScan(t);

    const items = await allFindings(t);
    expect(items.map((item) => item.packageName)).toEqual(["all-bad"]);
    expect(items[0]?.version).toBe("");
  });

  it("[SA-81] @latest 는 범위 없는 항목에 일치하고 검출의 버전은 원문의 버전 부분이다", async () => {
    await entry("npm", "all-bad");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow("npx all-bad@latest") } }]);

    await runScan(t);

    expect((await allFindings(t)).map((item) => item.version)).toEqual(["latest"]);
  });

  it("[SA-72] 같은 파일의 같은 (이름, 버전)이 여러 번 나와도 검출은 1건", async () => {
    await entry("npm", "evil-cli");
    t.github.setRepos([
      { name: "svc", files: { [WF]: workflow("npx evil-cli", "npm i -g evil-cli", "npx evil-cli@1.0.0") } },
    ]);

    await runScan(t);

    expect((await allFindings(t)).map((item) => item.version).sort()).toEqual(["", "1.0.0"]);
  });

  it("[SA-73] pypi 명령: uvx/pip install 의 정확한 버전과 이름 정규화", async () => {
    await entry("pypi", "evil_pkg", "<2.0");
    await entry("pypi", "unversioned");
    t.github.setRepos([
      {
        name: "py",
        files: {
          Dockerfile: "FROM python:3\nRUN pip install Evil-Pkg==1.0 unversioned\nRUN uvx evil-pkg==3.0\n",
        },
      },
    ]);

    await runScan(t);

    const found = (await allFindings(t)).map((item) => `${item.packageName}@${item.version}`).sort();
    expect(found).toEqual(["Evil-Pkg@1.0", "unversioned@"]);
  });

  it("[SA-74] MCP 설정의 command + args 를 검출한다", async () => {
    await entry("npm", "evil-mcp", "=1.0.0");
    t.github.setRepos([
      {
        name: "ai",
        files: {
          ".mcp.json": JSON.stringify({
            mcpServers: { a: { command: "cmd", args: ["/c", "npx", "-y", "evil-mcp@1.0.0"] } },
          }),
        },
      },
    ]);

    await runScan(t);

    expect(await allFindings(t)).toMatchObject([{ filePath: ".mcp.json", packageName: "evil-mcp" }]);
  });

  it("[SA-75] 보조 파일만 있는 repo 는 skipped 가 아니고 fileCount 에 센다", async () => {
    await entry("npm", "evil-cli");
    t.github.setRepos([
      { name: "ci-only", files: { [WF]: workflow("npm test") } },
      { name: "docs", files: { "README.md": "x" } },
    ]);

    const scan = await runScan(t);

    const rows = await repoRows(scan.id);
    expect(rowOf(rows, "ci-only")).toMatchObject({ status: "passed", fileCount: 1 });
    expect(rowOf(rows, "docs")).toMatchObject({ status: "skipped", fileCount: 0 });
  });

  it("[SA-76] npm·pypi 의 활성 항목이 없으면 보조 파일을 받지 않는다 (skipped 가 아니고 fileCount 0)", async () => {
    await entry("go", "github.com/evil/mod");
    t.github.setRepos([
      { name: "ci-only", files: { [WF]: workflow("npx evil-cli"), Dockerfile: "FROM x\n" } },
    ]);

    const scan = await runScan(t);

    expect(t.github.callsOf("getFile", "ci-only")).toHaveLength(0);
    expect(rowOf(await repoRows(scan.id), "ci-only")).toMatchObject({ status: "passed", fileCount: 0 });
  });

  it("[SA-77] 보조 파일의 파싱 실패는 그 파일만 건너뛰고 경고하며 repo 는 실패가 아니다", async () => {
    await entry("npm", "evil-cli");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({ dependencies: { "evil-cli": "1.0.0" } }),
          [WF]: "a: [1,\n",
          Dockerfile: "FROM x\nRUN npx evil-cli\n",
        },
      },
    ]);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    const items = await allFindings(t);
    expect(items.map((item) => item.filePath).sort()).toEqual(["Dockerfile", "package.json"]);
    expect(t.logger.texts("warn").some((text) => text.includes(WF))).toBe(true);
  });

  it("[SA-78] 보조 파일 조회 실패는 repo 실패다", async () => {
    await entry("npm", "evil-cli");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow("npx evil-cli") } }]);
    t.github.failFile("svc", WF, new Error("boom"));

    const scan = await runScan(t);

    expect(scan.status).toBe("partial");
    expect(rowOf(await repoRows(scan.id), "svc").status).toBe("failed");
  });

  it("[SA-79] 항목을 끄면 보조 파일의 검출도 resolved 된다", async () => {
    const added = await entry("npm", "evil-cli");
    t.github.setRepos([{ name: "svc", files: { [WF]: workflow("npx evil-cli") } }]);
    await runScan(t);
    expect(await allFindings(t)).toHaveLength(1);

    await putEntry(t, added.id, { name: "evil-cli", versionRange: null, reason: "x", enabled: false });
    await runScan(t);

    expect((await allFindings(t))[0]?.status).toBe("resolved");
  });

  it("[SA-80] node_modules 안의 보조 파일은 받지 않는다", async () => {
    await entry("npm", "evil-cli");
    t.github.setRepos([
      { name: "svc", files: { "package.json": pkgJson(), "node_modules/x/Dockerfile": "RUN npx evil-cli\n" } },
    ]);

    await runScan(t);

    expect(await allFindings(t)).toHaveLength(0);
  });
});
