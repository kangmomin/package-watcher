import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoInfo, type FakeRepoInput } from "../test/github.ts";
import { pkgJson } from "../test/repoFixtures.ts";
import {
  addBlacklist,
  allFindings,
  cleanupTestApps,
  createTestApp,
  EVIL,
  findOne,
  ORG,
  putSettings,
  runScan,
  type TestApp,
} from "../test/testApp.ts";

/**
 * resolve 대상 ②(대상 목록에 없는 repo)와 ③(package.json 0개), ② 안전장치.
 * 목록 크기 변화가 안전장치 경계(절반)에 걸리지 않게 filler repo 를 둔다.
 */

const withEvil = () => pkgJson({ dependencies: { "evil-pkg": "^1.0.0" } });
const clean = () => pkgJson({ dependencies: { "safe-lib": "^2.0.0" } });

function fillers(count: number, prefix = "filler"): FakeRepoInput[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    files: { "package.json": clean() },
  }));
}

let t: TestApp;

beforeEach(async () => {
  t = createTestApp();
  await putSettings(t);
  await addBlacklist(t, EVIL);
});

afterEach(cleanupTestApps);

async function nextScan() {
  t.clock.advance(60_000);
  return runScan(t);
}

describe("resolve ② — 대상 목록에서 빠진 repo 재확인", () => {
  it("[EC-04] 재확인이 404(삭제)면 그 repo 의 활성 검출을 resolve 한다", async () => {
    t.github.setRepos([...fillers(4), { name: "gone", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.removeRepo("gone");
    const scan = await nextScan();

    expect(scan.status).toBe("success");
    expect(findOne(await allFindings(t), { repo: "gone" }).status).toBe("resolved");
  });

  it("[EC-04] archived 가 된 repo 의 활성 검출을 resolve 한다", async () => {
    t.github.setRepos([...fillers(4), { name: "old", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.setArchived("old", true);
    const scan = await nextScan();

    expect(scan.repoCount).toBe(4);
    expect(findOne(await allFindings(t), { repo: "old" }).status).toBe("resolved");
  });

  it("[EC-04] 재확인 응답의 full_name 이 다르면(이름 변경·이전, 대소문자 무시) resolve 한다", async () => {
    t.github.setRepos([...fillers(4), { name: "old-name", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.removeRepo("old-name");
    t.github.upsertRepo({ name: "new-name", files: { "package.json": withEvil() } });
    t.github.lookups.set("old-name", repoInfo(ORG, "new-name"));
    const scan = await nextScan();

    expect(scan.status).toBe("success");
    const items = await allFindings(t);
    expect(findOne(items, { repo: "old-name" }).status).toBe("resolved");
    expect(findOne(items, { repo: "new-name" }).status).toBe("open");
  });

  it("[EC-01] 재확인이 같은 이름의 활성 repo(200)면 검출을 유지하고 failedRepos 에 넣는다", async () => {
    t.github.setRepos([...fillers(4), { name: "private-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.hide("private-svc");
    t.github.lookups.set("private-svc", repoInfo(ORG, "Private-Svc", { fullName: "My-Org/private-svc" }));
    const scan = await nextScan();

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo)).toContain("private-svc");
    expect(findOne(await allFindings(t), { repo: "private-svc" }).status).toBe("open");
  });

  it("[EC-01] 재확인이 그 외 오류면 검출을 유지한다", async () => {
    t.github.setRepos([...fillers(4), { name: "unknown", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.hide("unknown");
    t.github.lookups.set("unknown", new Error("GitHub API 오류 (500)"));
    await nextScan();

    expect(findOne(await allFindings(t), { repo: "unknown" })).toMatchObject({
      status: "open",
      resolvedAt: null,
    });
  });
});

describe("resolve ③ — package.json 이 0개가 된 repo", () => {
  it("[EC-04] package.json 이 0개가 된 repo 의 활성 검출을 resolve 한다 (실패 아님)", async () => {
    t.github.setRepos([{ name: "svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.setFiles("svc", { "README.md": "# moved to another language" });
    const scan = await nextScan();

    expect(scan).toMatchObject({ status: "success", failedRepos: [] });
    expect(findOne(await allFindings(t), { repo: "svc" }).status).toBe("resolved");
  });

  it("[EC-04] 커밋이 없는 빈 repo(tree 0개)도 package.json 0개로 처리해 resolve 한다", async () => {
    t.github.setRepos([{ name: "svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.setFiles("svc", {});
    const scan = await nextScan();

    expect(scan).toMatchObject({ status: "success", failedRepos: [] });
    expect(findOne(await allFindings(t), { repo: "svc" }).status).toBe("resolved");
  });
});

describe("resolve ② 안전장치 (listed_baseline)", () => {
  const twenty = (): FakeRepoInput[] => [
    ...fillers(18, "r"),
    { name: "hit-19", files: { "package.json": withEvil() } },
    { name: "hit-20", files: { "package.json": withEvil() } },
  ];

  it("[EC-01] 대상 목록이 0개면 ② resolve 를 보류하고 그 repo 를 failedRepos(접근 불가 의심)에 넣는다", async () => {
    t.github.setRepos([{ name: "svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.setRepos([]);
    const scan = await nextScan();

    expect(scan.status).toBe("partial");
    const failed = scan.failedRepos.find((entry) => entry.repo === "svc");
    expect(failed?.error).toContain("접근 불가");
    expect(findOne(await allFindings(t), { repo: "svc" }).status).toBe("open");
  });

  it("[EC-04] 20개 중 검출이 있는 2개가 삭제되면(절반 이하 감소) 둘 다 resolve 한다", async () => {
    t.github.setRepos(twenty());
    await runScan(t);

    t.github.removeRepo("hit-19");
    t.github.removeRepo("hit-20");
    const scan = await nextScan();

    expect(scan.status).toBe("success");
    const items = await allFindings(t);
    expect(findOne(items, { repo: "hit-19" }).status).toBe("resolved");
    expect(findOne(items, { repo: "hit-20" }).status).toBe("resolved");
  });

  it("[EC-01] 목록이 20개 → 5개로 절반 넘게 줄면 ② resolve 를 보류한다", async () => {
    t.github.setRepos(twenty());
    await runScan(t);

    t.github.setRepos(fillers(5, "r"));
    const scan = await nextScan();

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo)).toEqual(
      expect.arrayContaining(["hit-19", "hit-20"]),
    );
    const items = await allFindings(t);
    expect(findOne(items, { repo: "hit-19" }).status).toBe("open");
    expect(findOne(items, { repo: "hit-20" }).status).toBe("open");
  });

  it("[EC-01] 축소가 2회 연속이면 두 번째 스캔도 보류한다 (보류한 스캔은 기준값을 갱신하지 않는다)", async () => {
    t.github.setRepos(twenty());
    await runScan(t);

    t.github.setRepos(fillers(5, "r"));
    await nextScan();
    const second = await nextScan();

    expect(second.status).toBe("partial");
    const items = await allFindings(t);
    expect(findOne(items, { repo: "hit-19" }).status).toBe("open");
    expect(findOne(items, { repo: "hit-20" }).status).toBe("open");
  });

  it("[EC-04] 보류 다음 스캔에서 목록이 회복되면 정상 처리한다", async () => {
    t.github.setRepos(twenty());
    await runScan(t);
    const before = findOne(await allFindings(t), { repo: "hit-19" });

    t.github.setRepos(fillers(5, "r"));
    await nextScan();

    t.github.setRepos([...fillers(18, "r"), { name: "hit-19", files: { "package.json": withEvil() } }]);
    const recovered = await nextScan();

    expect(recovered.status).toBe("success");
    const items = await allFindings(t);
    expect(findOne(items, { repo: "hit-20" }).status).toBe("resolved");
    const hit19 = findOne(items, { repo: "hit-19" });
    expect(hit19).toMatchObject({ id: before.id, status: "open" });
  });
});

describe("resolve ② — 대소문자만 바뀐 repo 이름 (S-15)", () => {
  it("[EC-04] repo 이름이 대소문자만 바뀌면(Foo-Svc → foo-svc) 이전 이름의 검출을 resolve 하고 새 이름은 일반 repo 로 스캔한다 (partial 로 남지 않는다)", async () => {
    t.github.setRepos([...fillers(4), { name: "Foo-Svc", files: { "package.json": withEvil() } }]);
    await runScan(t);
    const before = findOne(await allFindings(t), { repo: "Foo-Svc" });

    // GitHub 는 repo 이름을 대소문자 무시로 찾으므로 이전 이름의 재확인도 200 + 새 정식 이름이다.
    t.github.removeRepo("Foo-Svc");
    t.github.upsertRepo({ name: "foo-svc", files: { "package.json": withEvil() } });
    t.github.lookups.set("Foo-Svc", repoInfo(ORG, "foo-svc"));
    const scan = await nextScan();

    expect(scan).toMatchObject({ status: "success", failedRepos: [], newFindingCount: 1 });
    const items = await allFindings(t);
    expect(findOne(items, { repo: "Foo-Svc" })).toMatchObject({ id: before.id, status: "resolved" });
    expect(findOne(items, { repo: "foo-svc" }).status).toBe("open");

    const after = await nextScan();
    expect(after).toMatchObject({ status: "success", failedRepos: [] });
  });

  it("[EC-01] 재확인 full_name 의 repo 이름이 정확히 같으면 org 의 대소문자만 달라도 같은 repo 다 (유지 + failedRepos)", async () => {
    t.github.setRepos([...fillers(4), { name: "private-svc", files: { "package.json": withEvil() } }]);
    await runScan(t);

    t.github.hide("private-svc");
    t.github.lookups.set("private-svc", repoInfo(ORG, "private-svc", { fullName: "My-Org/private-svc" }));
    const scan = await nextScan();

    expect(scan.status).toBe("partial");
    expect(scan.failedRepos.map((failed) => failed.repo)).toEqual(["private-svc"]);
    expect(findOne(await allFindings(t), { repo: "private-svc" })).toMatchObject({
      status: "open",
      resolvedAt: null,
    });
  });
});
