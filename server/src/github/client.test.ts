import { describe, expect, it } from "vitest";
import { createFetchMock, type MockReply } from "../test/fetchMock.ts";
import { createOctokitClient, RateLimitedError } from "./client.ts";

const API = "https://api.github.com";
const NOT_FOUND: MockReply = { status: 404, body: { message: "Not Found" } };

function repoJson(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: name.length,
    name,
    full_name: `my-org/${name}`,
    archived: false,
    fork: false,
    default_branch: "main",
    ...extra,
  };
}

function pageLink(page: number): string {
  const url = `${API}/orgs/my-org/repos?per_page=100&page=${page}`;
  return `<${url}>; rel="next", <${url}>; rel="last"`;
}

describe("createOctokitClient (fetch mock)", () => {
  it("[EC-02] listOrgRepos 는 Link 헤더의 모든 페이지를 받아 archived·fork 를 포함해 반환한다", async () => {
    const mock = createFetchMock(({ url }) => {
      if (url.pathname !== "/orgs/my-org/repos") return NOT_FOUND;
      const page = url.searchParams.get("page") ?? "1";
      if (page === "1") {
        return {
          status: 200,
          body: [repoJson("alpha"), repoJson("bravo", { archived: true })],
          headers: { link: pageLink(2) },
        };
      }
      if (page === "2") return { status: 200, body: [repoJson("charlie", { fork: true })] };
      return NOT_FOUND;
    });
    const client = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    const repos = await client.listOrgRepos("my-org");

    expect(repos.map((repo) => repo.name)).toEqual(["alpha", "bravo", "charlie"]);
    expect(repos[0]).toMatchObject({
      name: "alpha",
      fullName: "my-org/alpha",
      archived: false,
      fork: false,
      defaultBranch: "main",
    });
    expect(repos[1]).toMatchObject({ archived: true });
    expect(repos[2]).toMatchObject({ fork: true });
  });

  it("[EC-02] 목록의 2페이지가 실패하면 listOrgRepos 전체가 실패한다", async () => {
    const mock = createFetchMock(({ url }) => {
      if (url.pathname !== "/orgs/my-org/repos") return NOT_FOUND;
      const page = url.searchParams.get("page") ?? "1";
      if (page === "1") {
        return { status: 200, body: [repoJson("alpha")], headers: { link: pageLink(2) } };
      }
      return NOT_FOUND;
    });
    const client = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    await expect(client.listOrgRepos("my-org")).rejects.toThrow();
    expect(mock.calls.some((call) => call.url.searchParams.get("page") === "2")).toBe(true);
  });

  it("[AC-03] getFile 은 blob API 로 1MB 를 넘는 파일(1.5MB)을 읽는다", async () => {
    const content = `// 한글 UTF-8 확인\n${"0123456789abcdef".repeat(98_304)}`;
    const base64 = Buffer.from(content, "utf8").toString("base64").replace(/.{60}/g, "$&\n");
    const blobPath = "/repos/my-org/api/git/blobs/sha-big";
    const mock = createFetchMock(({ url, headers }) => {
      if (url.pathname !== blobPath) return NOT_FOUND;
      if ((headers.get("accept") ?? "").includes("raw")) {
        return { status: 200, body: content, headers: { "content-type": "text/plain; charset=utf-8" } };
      }
      return {
        status: 200,
        body: {
          sha: "sha-big",
          node_id: "B_1",
          size: Buffer.byteLength(content),
          url: `${API}${blobPath}`,
          content: base64,
          encoding: "base64",
        },
      };
    });
    const client = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    const text = await client.getFile("my-org", "api", "sha-big");

    expect(text.length).toBe(content.length);
    expect(text === content).toBe(true);
    expect(mock.calls.some((call) => call.url.pathname === blobPath)).toBe(true);
    expect(mock.calls.some((call) => call.url.pathname.includes("/contents/"))).toBe(false);
  });

  it("[EC-01] 빈 repo 의 tree 조회(409)는 실패가 아니라 빈 tree 이고 재시도하지 않는다", async () => {
    const mock = createFetchMock(({ url }) =>
      url.pathname.startsWith("/repos/my-org/empty/")
        ? { status: 409, body: { message: "Git Repository is empty." } }
        : NOT_FOUND,
    );
    const client = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    const tree = await client.getTree("my-org", "empty", "main");

    expect(tree).toEqual({ entries: [], truncated: false });
    const paths = mock.calls.map((call) => `${call.method} ${call.url.pathname}${call.url.search}`);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("[EC-04] getRepo 는 301(이름 변경·이전)을 따라가서 새 full_name 을 반환하고 404 는 null 이다", async () => {
    const mock = createFetchMock(({ url }) => {
      if (url.pathname === "/repos/my-org/old-name") {
        return {
          status: 301,
          headers: { location: `${API}/repositories/42` },
          body: { message: "Moved Permanently", url: `${API}/repositories/42` },
        };
      }
      if (url.pathname === "/repositories/42") return { status: 200, body: repoJson("new-name") };
      return NOT_FOUND;
    });
    const client = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    await expect(client.getRepo("my-org", "old-name")).resolves.toMatchObject({
      name: "new-name",
      fullName: "my-org/new-name",
    });
    await expect(client.getRepo("my-org", "gone")).resolves.toBeNull();
  });

  it("[EC-01] primary rate limit 소진은 기다리지 않고 RateLimitedError 로 실패한다", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const mock = createFetchMock(({ url }) =>
      url.pathname.startsWith("/repos/my-org/api/")
        ? {
            status: 403,
            headers: {
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "0",
              "x-ratelimit-used": "5000",
              "x-ratelimit-reset": String(reset),
              "x-ratelimit-resource": "core",
            },
            body: {
              message: "API rate limit exceeded for user ID 1.",
              documentation_url: "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api",
            },
          }
        : NOT_FOUND,
    );
    const client = createOctokitClient({ token: "test-token", fetch: mock.fetch });
    const started = Date.now();

    await expect(client.getTree("my-org", "api", "main")).rejects.toBeInstanceOf(RateLimitedError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
