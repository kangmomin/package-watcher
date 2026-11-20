import { describe, expect, it } from "vitest";
import { repoFullNameOf, repoKeyOf, splitRepoKey } from "./accountClient.ts";
import type { RepoInfo } from "./client.ts";

const info = (fullName: string): RepoInfo => ({
  name: fullName.slice(fullName.indexOf("/") + 1),
  fullName,
  archived: false,
  fork: false,
  defaultBranch: "main",
  pushedAt: null,
});

describe("로그인 계정 대상의 repo 이름", () => {
  it("계정이 소유한 repo 는 이름만, 다른 owner 의 repo 는 owner/name 이다 (owner 는 대소문자 무시)", () => {
    expect(repoKeyOf("me", info("Me/api"))).toBe("api");
    expect(repoKeyOf("me", info("friend/lib"))).toBe("friend/lib");
  });

  it("이름을 실제 (owner, name) 과 owner/name 으로 되돌린다", () => {
    expect(splitRepoKey("me", "api")).toEqual(["me", "api"]);
    expect(splitRepoKey("me", "friend/lib")).toEqual(["friend", "lib"]);
    expect(repoFullNameOf("me", "api")).toBe("me/api");
    expect(repoFullNameOf("me", "friend/lib")).toBe("friend/lib");
  });
});
