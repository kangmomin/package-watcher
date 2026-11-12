import { describe, expect, it } from "vitest";
import { assignLockfiles, readWorkspaceGlobs, type LockfileAssignment } from "./workspaces.ts";

function owners(result: LockfileAssignment, lockfile: string): string[] {
  return [...(result.byLockfile.get(lockfile) ?? [])].sort();
}

function lockfilesOf(result: LockfileAssignment, packageJson: string): string[] {
  return [...(result.byPackageJson.get(packageJson) ?? [])].sort();
}

describe("readWorkspaceGlobs", () => {
  it("[AC-03] npm/yarn/bun 은 package.json 의 workspaces(배열 또는 .packages)를 읽는다", () => {
    expect(readWorkspaceGlobs("npm", { packageJson: { workspaces: ["packages/*"] } })).toEqual([
      "packages/*",
    ]);
    expect(
      readWorkspaceGlobs("yarn", { packageJson: { workspaces: { packages: ["apps/*"] } } }),
    ).toEqual(["apps/*"]);
    expect(readWorkspaceGlobs("bun", { packageJson: { workspaces: ["libs/*"] } })).toEqual([
      "libs/*",
    ]);
  });

  it("[AC-03] pnpm 은 pnpm-workspace.yaml 의 packages 만 읽는다", () => {
    const yaml = "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n";
    expect(
      readWorkspaceGlobs("pnpm", {
        packageJson: { workspaces: ["ignored/*"] },
        pnpmWorkspaceYaml: yaml,
      }),
    ).toEqual(["packages/*", "!packages/legacy"]);
    expect(readWorkspaceGlobs("npm", { pnpmWorkspaceYaml: yaml })).toEqual([]);
  });

  it("[AC-03] 선언이 없거나 비었거나 형식이 다르면 glob 0개 (예외 없음)", () => {
    expect(readWorkspaceGlobs("pnpm", { pnpmWorkspaceYaml: "" })).toEqual([]);
    expect(readWorkspaceGlobs("pnpm", { pnpmWorkspaceYaml: "catalog:\n  react: ^18\n" })).toEqual(
      [],
    );
    expect(readWorkspaceGlobs("pnpm", {})).toEqual([]);
    expect(readWorkspaceGlobs("npm", { packageJson: { workspaces: "packages/*" } })).toEqual([]);
    expect(readWorkspaceGlobs("yarn", { packageJson: { workspaces: { nohoist: ["x"] } } })).toEqual(
      [],
    );
    expect(readWorkspaceGlobs("npm", { packageJson: { name: "app" } })).toEqual([]);
  });
});

describe("assignLockfiles (A-1 귀속 규칙)", () => {
  it("[AC-03] 담당 package.json 이 없는 lockfile 은 담당 0개다", () => {
    const result = assignLockfiles(
      ["package.json"],
      [{ path: "tools/yarn.lock", globs: [] }],
    );
    expect(owners(result, "tools/yarn.lock")).toEqual([]);
    expect(lockfilesOf(result, "package.json")).toEqual([]);
  });

  it("[AC-03] 이중 귀속: 같은 디렉터리 lockfile 이 우선하고, 그다음 가장 가까운 디렉터리 1곳에만 귀속한다", () => {
    const result = assignLockfiles(
      [
        "package.json",
        "packages/a/package.json",
        "packages/b/package.json",
        "apps/web/package.json",
        "apps/web/site/package.json",
      ],
      [
        { path: "package-lock.json", globs: ["packages/*", "apps/*", "apps/*/*"] },
        { path: "packages/a/package-lock.json", globs: [] },
        { path: "apps/web/package-lock.json", globs: ["site"] },
      ],
    );
    expect(lockfilesOf(result, "package.json")).toEqual(["package-lock.json"]);
    expect(lockfilesOf(result, "packages/a/package.json")).toEqual([
      "packages/a/package-lock.json",
    ]);
    expect(lockfilesOf(result, "packages/b/package.json")).toEqual(["package-lock.json"]);
    expect(lockfilesOf(result, "apps/web/package.json")).toEqual(["apps/web/package-lock.json"]);
    expect(lockfilesOf(result, "apps/web/site/package.json")).toEqual([
      "apps/web/package-lock.json",
    ]);
    expect(owners(result, "package-lock.json")).toEqual([
      "package.json",
      "packages/b/package.json",
    ]);
  });

  it("[AC-03] 같은 디렉터리에 lockfile 이 2종 이상이면 모두 담당 lockfile 이다", () => {
    const result = assignLockfiles(
      ["package.json"],
      [
        { path: "package-lock.json", globs: [] },
        { path: "yarn.lock", globs: [] },
      ],
    );
    expect(lockfilesOf(result, "package.json")).toEqual(["package-lock.json", "yarn.lock"]);
    expect(owners(result, "package-lock.json")).toEqual(["package.json"]);
    expect(owners(result, "yarn.lock")).toEqual(["package.json"]);
  });

  it("[AC-03] glob 은 디렉터리에 매칭하고 ./ 접두·끝 / 를 정규화하며 ! 부정 패턴을 지원한다", () => {
    const result = assignLockfiles(
      [
        "package.json",
        "packages/a/package.json",
        "packages/excluded/package.json",
        "apps/site/package.json",
      ],
      [{ path: "pnpm-lock.yaml", globs: ["./packages/*/", "!packages/excluded", "apps/*"] }],
    );
    expect(owners(result, "pnpm-lock.yaml")).toEqual([
      "apps/site/package.json",
      "package.json",
      "packages/a/package.json",
    ]);
    expect(lockfilesOf(result, "packages/excluded/package.json")).toEqual([]);
  });

  it("[AC-02] workspace 로 선언되지 않은 하위 폴더의 package.json 은 담당 lockfile 이 없다", () => {
    const result = assignLockfiles(
      ["package.json", "packages/a/package.json", "scripts/package.json"],
      [{ path: "package-lock.json", globs: ["packages/*"] }],
    );
    expect(lockfilesOf(result, "scripts/package.json")).toEqual([]);
    expect(lockfilesOf(result, "packages/a/package.json")).toEqual(["package-lock.json"]);
  });
});

describe("readWorkspaceGlobs — 깨진 pnpm-workspace.yaml (S-14)", () => {
  it("[EC-13] YAML 문법이 깨진 pnpm-workspace.yaml 은 glob 0개가 아니라 예외다", () => {
    const broken = [
      "packages:\n  - 'packages/*\n", // 닫히지 않은 따옴표
      "packages: [apps/*, packages/*\n", // 닫히지 않은 flow sequence
      "packages:\n\t- 'packages/*'\n", // 탭 들여쓰기
    ];
    for (const yaml of broken) {
      expect(() => readWorkspaceGlobs("pnpm", { pnpmWorkspaceYaml: yaml })).toThrow(
        /pnpm-workspace\.yaml/,
      );
    }
  });

  it("[EC-13] 문법이 맞으면 주석뿐인 파일·packages 형식 불일치·최상위 목록은 지금처럼 glob 0개다", () => {
    for (const yaml of ["# packages 없음\n", "packages: 'packages/*'\n", "- packages/*\n"]) {
      expect(readWorkspaceGlobs("pnpm", { pnpmWorkspaceYaml: yaml })).toEqual([]);
    }
  });
});
