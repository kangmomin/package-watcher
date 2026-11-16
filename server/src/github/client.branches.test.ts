import { describe, expect, it } from "vitest";
import { createFetchMock, type MockReply } from "../test/fetchMock.ts";
import { createOctokitClient, pickRecentBranches, pickRecentPushes, RateLimitedError, RECENT_BRANCHES_QUERY } from "./client.ts";

const SINCE = "2026-11-05T00:00:00.000Z";
const node = (name: string, committedDate: string, oid = `oid-${name}`) => ({ name, target: { oid, committedDate } });
const data = (nodes: unknown[], defaultName: string | null = "main") => ({
  repository: { defaultBranchRef: defaultName ? { name: defaultName } : null, refs: { nodes } },
});

function client(reply: MockReply) {
  const mock = createFetchMock(({ url }) =>
    url.pathname === "/graphql" ? reply : { status: 404, body: { message: "Not Found" } },
  );
  return { mock, github: createOctokitClient({ token: "test-token", fetch: mock.fetch }) };
}

describe("pickRecentBranches", () => {
  it("[SF-72] 기본 브랜치와 since 이전의 브랜치를 빼고 최근 순으로 고른다", () => {
    const picked = pickRecentBranches(
      data([
        node("main", "2026-11-11T00:00:00Z"),
        node("old", "2026-11-04T23:59:59Z"),
        node("a", "2026-11-08T00:00:00Z"),
        node("b", "2026-11-10T00:00:00Z"),
        node("edge", "2026-11-05T00:00:00Z"),
      ]),
      SINCE,
    );

    expect(picked.map((branch) => branch.name)).toEqual(["b", "a", "edge"]);
    expect(picked[0]).toEqual({ name: "b", committedAt: "2026-11-10T00:00:00Z", sha: "oid-b" });
  });

  it("[SF-73] 기간 안의 후보는 모두 돌려주고(상한은 호출한 쪽) 형식이 이상한 노드는 건너뛴다", () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`b${i}`, `2026-11-10T00:${String(i).padStart(2, "0")}:00Z`));

    const picked = pickRecentBranches(data([null, { name: "x" }, { name: "y", target: {} }, ...many]), SINCE);

    expect(picked).toHaveLength(30);
    expect(picked[0]?.name).toBe("b29");
  });

  it("[SF-74] repo 가 없거나 비어 있으면 []", () => {
    expect(pickRecentBranches({ repository: null }, SINCE)).toEqual([]);
    expect(pickRecentBranches(data([]), SINCE)).toEqual([]);
    expect(pickRecentBranches(null, SINCE)).toEqual([]);
  });
});

describe("listRecentBranches (fetch mock)", () => {
  it("[SF-75] GraphQL 1회로 요청하고 owner·name 을 변수로 보낸다", async () => {
    const { mock, github } = client({ status: 200, body: { data: data([node("a", "2026-11-10T00:00:00Z")]) } });

    const found = await github.listRecentBranches("my-org", "svc", SINCE);

    expect(found).toEqual([{ name: "a", committedAt: "2026-11-10T00:00:00Z", sha: "oid-a" }]);
    expect(mock.calls).toHaveLength(1);
    const sent = JSON.parse(mock.calls[0]?.body ?? "{}") as { query: string; variables: unknown };
    expect(sent.variables).toEqual({ owner: "my-org", name: "svc" });
    expect(sent.query).toBe(RECENT_BRANCHES_QUERY);
    expect(sent.query).toContain("TAG_COMMIT_DATE");
  });

  it("[SF-76] rate limit 은 RateLimitedError, repo 없음(NOT_FOUND)은 [], 그 외 오류는 throw", async () => {
    const limited = client({ status: 200, body: { data: null, errors: [{ type: "RATE_LIMITED", message: "limit" }] } });
    await expect(limited.github.listRecentBranches("my-org", "svc", SINCE)).rejects.toBeInstanceOf(RateLimitedError);

    const missing = client({
      status: 200,
      body: { data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve", path: ["repository"] }] },
    });
    expect(await missing.github.listRecentBranches("my-org", "svc", SINCE)).toEqual([]);

    const broken = client({ status: 500, body: { message: "boom" } });
    await expect(broken.github.listRecentBranches("my-org", "svc", SINCE)).rejects.toThrow();
  });

  it("[SF-77] REST 의 repo 목록은 pushed_at 을 pushedAt 으로 채운다", async () => {
    const mock = createFetchMock(({ url }) =>
      url.pathname === "/orgs/my-org/repos"
        ? {
            status: 200,
            body: [
              { id: 1, name: "a", full_name: "my-org/a", archived: false, fork: false, default_branch: "main", pushed_at: "2026-11-10T00:00:00Z" },
              { id: 2, name: "b", full_name: "my-org/b", archived: false, fork: false, default_branch: "main", pushed_at: null },
            ],
          }
        : { status: 404, body: { message: "Not Found" } },
    );
    const github = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    const repos = await github.listOrgRepos("my-org");

    expect(repos.map((repo) => repo.pushedAt)).toEqual(["2026-11-10T00:00:00Z", null]);
  });
});

describe("pickRecentPushes", () => {
  it("[SF-113] PushEvent·CreateEvent(branch)만, 기간 안의 것만, 브랜치마다 가장 최근 시각을 남긴다", () => {
    const picked = pickRecentPushes(
      [
        { type: "PushEvent", created_at: "2026-11-10T00:00:00Z", payload: { ref: "refs/heads/a" } },
        { type: "PushEvent", created_at: "2026-11-11T00:00:00Z", payload: { ref: "refs/heads/a" } },
        { type: "CreateEvent", created_at: "2026-11-09T00:00:00Z", payload: { ref: "b", ref_type: "branch" } },
        { type: "CreateEvent", created_at: "2026-11-09T00:00:00Z", payload: { ref: "v1", ref_type: "tag" } },
        { type: "PushEvent", created_at: "2026-11-09T00:00:00Z", payload: { ref: "refs/tags/v1" } },
        { type: "PushEvent", created_at: "2026-11-01T00:00:00Z", payload: { ref: "refs/heads/old" } },
        { type: "WatchEvent", created_at: "2026-11-10T00:00:00Z", payload: {} },
        null,
      ],
      SINCE,
    );

    expect([...picked]).toEqual([["a", "2026-11-11T00:00:00Z"], ["b", "2026-11-09T00:00:00Z"]]);
    expect(pickRecentPushes("x", SINCE).size).toBe(0);
  });

  it("[SF-114] listRecentPushes 는 events API 1회, 404 는 빈 Map", async () => {
    const mock = createFetchMock(({ url }) =>
      url.pathname === "/repos/my-org/svc/events"
        ? { status: 200, body: [{ type: "PushEvent", created_at: "2026-11-10T00:00:00Z", payload: { ref: "refs/heads/a" } }] }
        : { status: 404, body: { message: "Not Found" } },
    );
    const github = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    expect([...(await github.listRecentPushes("my-org", "svc", SINCE))]).toEqual([["a", "2026-11-10T00:00:00Z"]]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url.searchParams.get("per_page")).toBe("100");
    expect((await github.listRecentPushes("my-org", "none", SINCE)).size).toBe(0);
  });
});
