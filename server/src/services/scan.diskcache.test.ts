import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { npmLockV3, pkgJson } from "../test/repoFixtures.ts";
import { allFindings, cleanupTestApps, createTestApp, putSettings, runScan } from "../test/testApp.ts";
import { addEntry } from "../test/v2.ts";

const dirs: string[] = [];
afterEach(async () => {
  await cleanupTestApps();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cacheDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "pw-scan-blob-"));
  dirs.push(dir);
  return dir;
};
const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((sub) => readdirSync(join(dir, sub)).map((name) => join(dir, sub, name)));

const FILES = {
  "package.json": pkgJson(),
  "package-lock.json": npmLockV3({ "ok-pkg": "1.0.0", "evil-pkg": "1.0.0" }),
};

async function appWith(blobCacheDir?: string) {
  const t = createTestApp({ blobCacheDir });
  await putSettings(t);
  await addEntry(t, { ecosystem: "npm", name: "evil-pkg", versionRange: null, reason: "악성" });
  t.github.setRepos([{ name: "svc", files: FILES }]);
  return t;
}

const rowsOf = async (t: Awaited<ReturnType<typeof appWith>>, id: number): Promise<object[]> => {
  const items = ((await t.request("GET", `/api/scans/${id}/repos`)).json as { items: object[] }).items;
  return items.map((row) => ({ ...row, startedAt: null, finishedAt: null }));
};

describe("blob 디스크 캐시 — 스캔", () => {
  it("[SH-37] 같은 repo 를 2번 스캔하면 두 번째의 getFile 요청이 0이고, 바뀐 파일(새 sha)만 요청한다", async () => {
    const t = await appWith(cacheDir());

    await runScan(t);
    expect(t.github.callsOf("getFile")).toHaveLength(2);
    await runScan(t);
    expect(t.github.callsOf("getFile")).toHaveLength(2);

    t.github.setFiles("svc", { ...FILES, "package.json": pkgJson({ name: "changed" }) });
    await runScan(t);
    expect(t.github.callsOf("getFile")).toHaveLength(3);
  });

  it("[SH-38] 캐시가 켜져도 검출과 repo 통계가 같다 (파일 수는 캐시 적중과 무관하게 평가에 쓴 수)", async () => {
    const plain = await appWith();
    const cached = await appWith(cacheDir());
    await runScan(cached); // 캐시를 채운다
    await runScan(plain); // 같은 횟수로 맞춘다(신규 수 비교)

    const a = await runScan(plain);
    const b = await runScan(cached);

    expect((await allFindings(cached)).map((f) => [f.filePath, f.packageName, f.status])).toEqual(
      (await allFindings(plain)).map((f) => [f.filePath, f.packageName, f.status]),
    );
    expect(await rowsOf(cached, b.id)).toEqual(await rowsOf(plain, a.id));
    expect(((await rowsOf(cached, b.id))[0] as { fileCount: number }).fileCount).toBe(2);
    expect(cached.github.callsOf("getFile")).toHaveLength(2);
  });

  it("[SH-39] 토큰이 있을 수 있는 .npmrc·.gitmodules·requirements 는 디스크에 남기지 않는다", async () => {
    const dir = cacheDir();
    const t = createTestApp({ blobCacheDir: dir, seedPolicy: true });
    await putSettings(t);
    await addEntry(t, { ecosystem: "pypi", name: "evil-py", versionRange: null, reason: "악성" });
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson(),
          ".npmrc": "//registry.example.com/:_authToken=SECRET-TOKEN-VALUE",
          ".gitmodules": `[submodule "x"]\n\tpath = x\n\turl = https://user:SECRET-TOKEN-VALUE@example.com/x.git\n`,
          "requirements.txt": "--extra-index-url https://u:SECRET-TOKEN-VALUE@pypi.example.com/simple\nokpkg==1.0.0\n",
        },
      },
    ]);

    await runScan(t);

    const called = t.github.callsOf("getFile").length;
    expect(called).toBe(4);
    for (const file of filesIn(dir)) expect(readFileSync(file, "utf8")).not.toContain("SECRET-TOKEN-VALUE");
    expect(filesIn(dir)).toHaveLength(1); // package.json 만 저장됐다
    await runScan(t);
    expect(t.github.callsOf("getFile").length).toBe(called + 3); // 3개는 매번 받는다
  });

  it("[SH-40] 브랜치의 받을 파일 상한은 디스크에 있는 파일을 세지 않는다", async () => {
    const dir = cacheDir();
    const t = createTestApp({ blobCacheDir: dir });
    await putSettings(t);
    await addEntry(t, { ecosystem: "npm", name: "evil-pkg", versionRange: null, reason: "악성" });
    const many: Record<string, string> = {};
    for (let i = 0; i < 301; i += 1) many[`p${i}/package.json`] = pkgJson({ name: `p${i}` });
    t.github.setRepos([{ name: "svc", files: many, pushedAt: "2026-11-11T00:00:00.000Z" }]);
    t.github.setHead("svc", "b", {
      committedAt: "2026-11-10T00:00:00.000Z",
      files: { ...many, "x/package.json": pkgJson({ name: "x", dependencies: { "evil-pkg": "1.0.0" } }) },
    });

    const scan = await runScan(t);

    // 의존성 파일 302개가 모두 입력이지만 301개는 이미 받았다(메모리) — 상한 300 은 새로 받을 1개만 센다
    expect((await allFindings(t)).map((f) => `${f.ref}|${f.filePath}`)).toEqual(["b|x/package.json"]);
    expect(scan.status).toBe("success");
    expect(t.github.callsOf("getFile")).toHaveLength(302);
  });

  it("[SH-55] 디스크에는 package.json·lock·workflow 만 두고 mcp·compose·Dockerfile 은 남기지 않는다", async () => {
    const dir = cacheDir();
    const t = createTestApp({ blobCacheDir: dir, seedPolicy: true });
    await putSettings(t);
    t.github.setRepos([
      {
        name: "svc",
        files: {
          "package.json": pkgJson(),
          ".github/workflows/ci.yml": "on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo hi\n",
          ".mcp.json": '{"mcpServers":{"a":{"command":"npx","args":["x"],"env":{"API_TOKEN":"SECRET-API-TOKEN"}}}}',
          "docker-compose.yml": "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: SECRET-DB-PASSWORD\n",
          Dockerfile: "FROM node:20\nENV TOKEN=SECRET-ENV-VALUE\n",
        },
      },
    ]);

    await runScan(t);

    const called = t.github.callsOf("getFile").length;
    expect(called).toBe(5);
    expect(filesIn(dir)).toHaveLength(2);
    for (const file of filesIn(dir)) expect(readFileSync(file, "utf8")).not.toContain("SECRET");
    await runScan(t);
    expect(t.github.callsOf("getFile").length).toBe(called + 3);
  });

  it("[SH-56] lock 의 resolved 에 자격 증명이 든 URL 이 있으면 그 파일은 디스크에 남기지 않는다", async () => {
    const dir = cacheDir();
    const t = createTestApp({ blobCacheDir: dir });
    await putSettings(t);
    const lock = npmLockV3({ "ok-pkg": "1.0.0" }).replaceAll("https://registry.npmjs.org", "https://user:s3cret@registry.npmjs.org");
    t.github.setRepos([{ name: "svc", files: { "package.json": pkgJson(), "package-lock.json": lock } }]);

    await runScan(t);

    expect(filesIn(dir)).toHaveLength(1); // package.json 만
    for (const file of filesIn(dir)) expect(readFileSync(file, "utf8")).not.toContain("s3cret");
  });

  it("[SH-57] 쓰기가 실패하면 검출은 그대로이고 요청 수 로그에 캐시 쓰기 실패 횟수가 붙는다", async () => {
    const blocker = cacheDir();
    const file = join(blocker, "not-a-dir");
    writeFileSync(file, "x");
    const t = await appWith(file);

    const scan = await runScan(t);

    expect(scan.status).toBe("success");
    expect((await allFindings(t)).map((f) => f.packageName)).toEqual(["evil-pkg"]);
    const line = t.logger.texts("info").find((text) => text.startsWith(`스캔 #${scan.id}: GitHub 요청`));
    expect(line).toMatch(/캐시 쓰기 실패 2회/);
  });
});
