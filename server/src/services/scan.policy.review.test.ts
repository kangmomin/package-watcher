import { type BlacklistEntry, type PolicyCheckId } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../repositories/index.ts";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import { FakeClock } from "../test/clock.ts";
import { FakeLogger } from "../test/logger.ts";
import { connectMcp } from "../test/mcp.ts";
import {
  cleanupTestApps,
  createTestApp,
  listFindings,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";
import { createIndicatorRules } from "./scanIndicators.ts";
import { seedPolicyEntries } from "./policySeed.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp({ seedPolicy: true });
  await putSettings(t);
});

afterEach(cleanupTestApps);

async function only(...ids: PolicyCheckId[]): Promise<void> {
  const entries = await listEntries(t, { ecosystem: "policy" });
  const off = entries.filter((entry) => !ids.includes(entry.name as PolicyCheckId)).map((entry) => entry.id);
  const res = await t.request("POST", "/api/blacklist/bulk", { action: "disable", ids: off });
  expect(res.status, res.text).toBe(200);
}

async function found(id: PolicyCheckId) {
  const entry = (await listEntries(t, { ecosystem: "policy" })).find((item) => item.name === id);
  return (await listFindings(t, { category: "policy" })).items.filter((f) => f.blacklistEntryId === entry?.id);
}

const WF = ".github/workflows/ci.yml";
const GOOD = "permissions: {}\njobs:\n  a:\n    steps:\n      - uses: o/r@main\n";
const lock = npmLockV3({});

describe("건너뛴 파일의 검출 유지", () => {
  async function seedFindings(): Promise<void> {
    await only("unpinned-action");
    await addEntry(t, { ecosystem: "actions", name: "o/r", versionRange: null, reason: "x" });
    t.github.setRepos([{ name: "svc", files: { [WF]: GOOD } }]);
    await runScan(t);
    const open = (await listFindings(t)).items;
    expect(open).toHaveLength(2);
    const policy = open.find((f) => f.ecosystem === "policy");
    const res = await t.request("PATCH", `/api/findings/${policy?.id}`, { status: "ignored" });
    expect(res.status, res.text).toBe(200);
  }

  const statuses = async () => (await listFindings(t)).items.map((f) => `${f.ecosystem}:${f.status}`).sort();

  it("[SD-100] YAML 오류로 건너뛴 파일의 policy·actions 검출(open·ignored)은 resolve 되지 않는다", async () => {
    await seedFindings();
    t.github.setFiles("svc", { [WF]: "a: [1,\n" });

    await runScan(t);

    expect(await statuses()).toEqual(["actions:open", "policy:ignored"]);

    t.github.setFiles("svc", { [WF]: GOOD });
    await runScan(t);
    expect(await statuses()).toEqual(["actions:open", "policy:ignored"]);
    expect((await listFindings(t)).total).toBe(2);
  });

  it("[SD-101] 1MB 를 넘어 건너뛴 파일도 검출을 유지하고, 파일이 고쳐져 평가되면 resolve 된다", async () => {
    await seedFindings();
    t.github.setFiles("svc", { [WF]: `${GOOD}#${"a".repeat(1_048_577)}\n` });
    await runScan(t);
    expect(await statuses()).toEqual(["actions:open", "policy:ignored"]);

    t.github.setFiles("svc", { [WF]: "permissions: {}\njobs: {}\n" });
    await runScan(t);
    expect((await listFindings(t, { status: "resolved" })).items).toHaveLength(2);
  });

  it("[SD-102] 파일이 tree 에서 사라지면 resolve 된다", async () => {
    await seedFindings();
    t.github.setFiles("svc", { [WF]: "a: [1,\n" });
    await runScan(t);
    t.github.setFiles("svc", { "README.md": "x" });

    await runScan(t);

    expect((await listFindings(t, { status: "resolved" })).total).toBe(2);
  });

  it("[SD-103] 8MB 를 넘어 content 검사를 건너뛴 파일의 경로를 알려 준다", async () => {
    const entry = { id: 1, ecosystem: "content", name: "needle-text", enabled: true } as BlacklistEntry;
    const rules = createIndicatorRules([entry]);
    const skipped = new Set<string>();

    const matches = await rules.matchContents(
      "r",
      "o/r",
      new Map([
        ["big.txt", "x".repeat(8 * 1024 * 1024 + 1)],
        ["ok.txt", "has needle-text"],
      ]),
      new FakeLogger(),
      skipped,
    );

    expect([...skipped]).toEqual(["big.txt"]);
    expect(matches.map((m) => m.filePath)).toEqual(["ok.txt"]);
  });
});

describe("unpinned-exec 의 제외 규칙", () => {
  const run = (lines: string[]) =>
    `permissions: {}\njobs:\n  a:\n    steps:\n      - run: |\n${lines.map((l) => `          ${l}`).join("\n")}\n`;

  it("[SD-104] 선언된 패키지의 bin 이름·스코프 패키지의 마지막 조각·변수 버전은 제외한다", async () => {
    await only("unpinned-exec");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({
            devDependencies: { typescript: "^5", "@angular/cli": "^17", "@scope/foo": "^1", vitest: "^2" },
          }),
          "package-lock.json": lock,
          [WF]: run([
            "npx tsc --noEmit",
            "npx ng build",
            "npx foo",
            "npx vitest run",
            "npx playwright@${PLAYWRIGHT_VERSION} test",
            "npx stranger",
            "npx jest",
          ]),
        },
      },
    ]);

    await runScan(t);

    expect((await found("unpinned-exec")).map((f) => f.packageName).sort()).toEqual(["jest", "stranger"]);
  });

  it("[SD-105] bin 이름의 패키지가 선언되지 않았으면 보고한다", async () => {
    await only("unpinned-exec");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({ devDependencies: { left: "1" } }),
          "package-lock.json": lock,
          [WF]: run(["npx tsc"]),
        },
      },
    ]);

    await runScan(t);

    expect((await found("unpinned-exec")).map((f) => f.packageName)).toEqual(["tsc"]);
  });
});

describe("tree 검사의 표시", () => {
  it("[SD-106] committed-node-modules 는 가장 얕은 폴더(같으면 정렬순)이고 version 은 비어 있으며 링크는 tree 다", async () => {
    await only("committed-node-modules");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "a/b/node_modules/x/package.json": "{}",
          "z/node_modules/y/package.json": "{}",
          "m/node_modules/y/package.json": "{}",
        },
      },
    ]);

    await runScan(t);

    const items = await found("committed-node-modules");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ filePath: "m/node_modules", version: "" });
    expect(items[0]?.htmlUrl).toBe("https://github.com/my-org/svc/tree/HEAD/m/node_modules");
  });

  it("[SD-107] 방향 전환·보이지 않는 유니코드와 줄 구분자도 잡고 한글·이모지 경로는 통과한다", async () => {
    await only("suspicious-filename");
    const bad = ["a\u202eb.js", "z\u200bw.js", "\ufeffbom.js", "l\u2028s.js", "j\u200djoin.js"];
    t.github.setRepos([
      {
        name: "svc",
        files: { ...Object.fromEntries(bad.map((name) => [name, "x"])), "한글/파일.ts": "6", "emoji-😀.md": "7" },
      },
    ]);

    await runScan(t);

    expect((await found("suspicious-filename")).map((f) => f.filePath).sort()).toEqual([...bad].sort());
  });
});

describe("missing-lockfile", () => {
  it("[SD-108] bun.lockb 가 같은 폴더나 상위 폴더에 있으면 lock 이 있는 것으로 보고 vendor 등 제외 폴더는 보지 않는다", async () => {
    await only("missing-lockfile");
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson({ dependencies: { a: "1" } }),
          "bun.lockb": "bin",
          "packages/x/package.json": pkgJson({ name: "x", dependencies: { b: "1" } }),
          "vendor/lib/package.json": pkgJson({ name: "lib", dependencies: { c: "1" } }),
        },
      },
      { name: "other", files: { "tools/package.json": pkgJson({ dependencies: { d: "1" } }), "app/bun.lockb": "b" } },
    ]);

    await runScan(t);

    expect((await found("missing-lockfile")).map((f) => `${f.repo}:${f.filePath}`)).toEqual([
      "other:tools/package.json",
    ]);
  });
});

describe("시작과 집계", () => {
  it("[SD-109] 동시 시작으로 이미 만들어진 항목이 있어도 seed 는 UNIQUE 위반 없이 끝난다", () => {
    const repos = createRepositories(t.instance.db);
    seedPolicyEntries(repos, new FakeClock());
    const racing = { ...repos, blacklist: { ...repos.blacklist, findByKey: () => null } };

    expect(() => seedPolicyEntries(racing, new FakeClock())).not.toThrow();
    expect(repos.blacklist.list({ ecosystem: "policy", q: undefined }, "2026-11-12")).toHaveLength(16);
  });

  it("[SD-110] open 검출 수는 SQL 로 repo 별로 센다 (policy 제외)", async () => {
    await only("suspicious-filename");
    await addEntry(t, { name: "evil-pkg", versionRange: null, reason: "x" });
    t.github.setRepos([
      { name: "a", files: { "package.json": pkgJson({ dependencies: { "evil-pkg": "1.0.0" } }), "x\u0001": "x" } },
      { name: "b", files: { "y\u0001": "x" } },
    ]);
    await runScan(t);

    const counts = createRepositories(t.instance.db).findings.openCountsByRepo();

    expect([...counts]).toEqual([["a", 1]]);
  });
});

describe("기본 목록", () => {
  it("[SD-111] category·excludeCategory 가 없으면 전체를 돌려주고, MCP 설명이 excludeCategory 를 안내한다", async () => {
    await only("suspicious-filename");
    t.github.setRepos([{ name: "a", files: { "y\u0001": "x" } }]);
    await runScan(t);
    expect((await listFindings(t)).total).toBe(1);

    const client = await connectMcp(t);
    const { tools } = await client.listTools();
    await client.close();
    const list = tools.find((tool) => tool.name === "list_findings");
    expect(list?.description).toContain('excludeCategory: "policy"');
  });
});
