import { describe, expect, it } from "vitest";
import { FakeGitHubClient } from "../test/github.ts";
import { createBlobCache } from "./blobCache.ts";

async function shaOf(github: FakeGitHubClient, path: string): Promise<string> {
  const tree = await github.getTree("o", "r", "main");
  const found = tree.entries.find((entry) => entry.path === path);
  if (!found) throw new Error(path);
  return found.sha;
}

describe("blob 캐시", () => {
  it("[SF-110] 같은 sha 는 1번만 받고 상한을 넘으면 더 넣지 않는다 (이미 든 것은 유지)", async () => {
    const github = new FakeGitHubClient();
    github.setRepos([{ name: "r", files: { a: "x".repeat(10), b: "y".repeat(10), c: "z".repeat(10) } }]);
    const [a, b, c] = [await shaOf(github, "a"), await shaOf(github, "b"), await shaOf(github, "c")];
    const cache = createBlobCache(github, 25);

    await cache.client.getFile("o", "r", a);
    await cache.client.getFile("o", "r", a);
    await cache.client.getFile("o", "r", b);
    await cache.client.getFile("o", "r", c); // 30자 > 25 → 넣지 않는다
    expect(cache.fetched()).toBe(3);
    expect([cache.has(a), cache.has(b), cache.has(c)]).toEqual([true, true, false]);

    await cache.client.getFile("o", "r", c); // 캐시에 없으니 다시 받는다
    await cache.client.getFile("o", "r", a); // 이미 든 것은 유지
    expect(cache.fetched()).toBe(4);
  });
});
