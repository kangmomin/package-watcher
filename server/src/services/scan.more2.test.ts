import { createHash } from "node:crypto";
import type { BlacklistEntry, Finding, PolicyCheckId } from "@pw/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allFindings,
  cleanupTestApps,
  createTestApp,
  listFindings,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";
import { addEntry, listEntries } from "../test/v2.ts";

let t: TestApp;

beforeEach(async () => {
  t = createTestApp({ seedPolicy: true });
  await putSettings(t);
});

afterEach(cleanupTestApps);

const policyEntries = (): Promise<BlacklistEntry[]> => listEntries(t, { ecosystem: "policy" });

async function only(...ids: PolicyCheckId[]): Promise<void> {
  const entries = await policyEntries();
  const off = entries.filter((item) => !ids.includes(item.name as PolicyCheckId)).map((item) => item.id);
  const res = await t.request("POST", "/api/blacklist/bulk", { action: "disable", ids: off });
  expect(res.status, res.text).toBe(200);
}

async function found(id: PolicyCheckId): Promise<string[]> {
  const target = (await policyEntries()).find((item) => item.name === id);
  return (await listFindings(t, { category: "policy" })).items
    .filter((f: Finding) => f.blacklistEntryId === target?.id && f.status !== "resolved")
    .map((f) => `${f.filePath}|${f.packageName}|${f.version}`)
    .sort();
}

const contentFindings = async (): Promise<string[]> =>
  (await allFindings(t)).filter((f) => f.ecosystem === "content").map((f) => f.filePath).sort();

const withScripts = (scripts: Record<string, string>): string =>
  `${JSON.stringify({ name: "app", version: "1.0.0", scripts })}\n`;

describe("[SG-220] policy 전용 파일은 content 검사의 대상이 아니다", () => {
  it("npmrc-token 이 받은 .npmrc·.gitmodules 의 문자열은 content 검출이 되지 않는다", async () => {
    await only("npmrc-token", "external-submodule");
    await addEntry(t, { ecosystem: "content", name: "marker-string-12345", versionRange: null, reason: "x" });
    t.github.setRepos([
      {
        name: "svc",
        files: {
          ".npmrc": "//npm.pkg.github.com/:_authToken=marker-string-12345\n",
          ".gitmodules": '[submodule "a"]\n\turl = https://x.io/marker-string-12345.git\n',
          "README.md": "plain",
          Dockerfile: "FROM node:20\n# marker-string-12345\n",
        },
      },
    ]);

    await runScan(t);

    expect(await contentFindings()).toEqual(["Dockerfile"]);
  });

  it("pypi 가 꺼져 있으면 custom-registry 의 켬·끔이 requirements.txt 의 content 검출을 바꾸지 않는다", async () => {
    await addEntry(t, { ecosystem: "content", name: "marker-string-12345", versionRange: null, reason: "x" });
    const files = { "requirements.txt": "--index-url https://x.io/simple\n# marker-string-12345\n" };
    await only("custom-registry");
    t.github.setRepos([{ name: "svc", files }]);
    await runScan(t);
    const on = await contentFindings();

    await only();
    await runScan(t);
    const off = await contentFindings();

    expect(on).toEqual(off);
    expect(on).toEqual([]);
  });
});

describe("[SG-221] content 항목만으로는 vscode·helm·terraform 파일을 받지 않는다", () => {
  it("해당 종류의 항목이 있을 때만 받는다", async () => {
    await only();
    await addEntry(t, { ecosystem: "content", name: "marker-string-12345", versionRange: null, reason: "x" });
    t.github.setRepos([
      {
        name: "svc",
        files: { "main.tf": 'module "a" {\n  source = "x/y/z"\n}\n# marker-string-12345\n', "Chart.yaml": "name: a\n", ".vscode/extensions.json": "{}" },
      },
    ]);

    await runScan(t);

    expect(t.github.callsOf("getFile", "svc")).toHaveLength(0);
  });
});

describe("[SG-222] install-script 의 hash 는 공백에 영향을 받지 않는다", () => {
  it("앞뒤 공백과 연속 공백이 달라도 같은 검출이다", async () => {
    await only("install-script");
    t.github.setRepos([{ name: "svc", files: { "package.json": withScripts({ postinstall: "node   a.js \n" }) } }]);
    await runScan(t);
    const first = await found("install-script");
    t.github.setRepos([{ name: "svc", files: { "package.json": withScripts({ postinstall: "  node a.js" }) } }]);
    await runScan(t);

    const expected = createHash("sha256").update("node a.js").digest("hex").slice(0, 12);
    expect(first).toEqual([`package.json|postinstall|${expected}`]);
    expect(await found("install-script")).toEqual(first);
  });
});

describe("[SG-223] npmrc-token 은 키마다 1건", () => {
  it("한 파일에 키가 여럿이면 키마다 1건이다", async () => {
    await only("npmrc-token");
    t.github.setRepos([{ name: "svc", files: { ".npmrc": "_password=aaaaaaaaaaaa\n_authToken=bbbbbbbbbbbb\n" } }]);

    await runScan(t);

    expect(await found("npmrc-token")).toEqual([".npmrc|_authToken|", ".npmrc|_password|"]);
  });
});

describe("[SG-224] external-submodule 의 내부 판정", () => {
  it("git://·http:// 는 같은 org 면 내부이고 ../../ 는 외부다", async () => {
    await only("external-submodule");
    const sub = (name: string, url: string) => `[submodule "${name}"]\n\turl = ${url}\n`;
    t.github.setRepos([
      {
        name: "svc",
        files: {
          ".gitmodules": [
            sub("a", "git://github.com/my-org/a.git"),
            sub("b", "http://github.com/my-org/b.git"),
            sub("c", "../c"),
            sub("d", "../../other/d"),
            sub("e", "./e"),
          ].join(""),
        },
      },
    ]);

    await runScan(t);

    expect(await found("external-submodule")).toEqual([".gitmodules|../../other/d|"]);
  });
});

describe("[SG-225] custom-registry 의 환경 변수 URL", () => {
  it("(환경 변수) 로 파일마다 1건 보고한다", async () => {
    await only("custom-registry");
    t.github.setRepos([{ name: "svc", files: { ".npmrc": "registry=${REG}\n@a:registry=${REG2}\n" } }]);

    await runScan(t);

    expect(await found("custom-registry")).toEqual([".npmrc|(환경 변수)|"]);
  });
});

describe("[SG-226] terraform 이름의 정규화로 항목을 비교한다", () => {
  it("표기가 다른 항목 둘이 모두 같은 module 에 일치하고 packageName 은 정규화한 값이다", async () => {
    await addEntry(t, { ecosystem: "terraform", name: "git::https://github.com/o/r.git", versionRange: null, reason: "x" });
    await addEntry(t, { ecosystem: "terraform", name: "github.com/o/r", versionRange: "v1.0.0", reason: "y" });
    t.github.setRepos([
      { name: "svc", files: { "main.tf": 'module "a" {\n  source = "git::git@github.com:O/R.git?ref=v1.0.0"\n}\n' } },
    ]);

    await runScan(t);

    const list = (await allFindings(t)).filter((f) => f.ecosystem === "terraform");
    expect(list.map((f) => `${f.packageName}@${f.version}`)).toEqual(["github.com/o/r@v1.0.0", "github.com/o/r@v1.0.0"]);
  });
});
