import { describe, expect, it } from "vitest";
import { createFetchMock } from "../test/fetchMock.ts";
import { createOctokitClient, pickCommits, pickPulls } from "./client.ts";

const SINCE = "2026-11-05T00:00:00.000Z";
const SHA = "a".repeat(40);

const rawCommit = (over: Record<string, unknown> = {}) => ({
  sha: SHA,
  html_url: `https://github.com/my-org/svc/commit/${SHA}`,
  author: { login: "alice" },
  commit: { message: "feat: x", author: { email: "a@x.io", date: "2026-11-09T00:00:00Z" }, committer: { date: "2026-11-10T00:00:00Z" } },
  ...over,
});

describe("pickCommits·pickPulls", () => {
  it("[SG-100] 커밋은 메시지를 2000자로 자르고 sha·시각이 이상한 항목은 건너뛴다", () => {
    const picked = pickCommits([
      rawCommit({ commit: { message: "x".repeat(5000), committer: { date: "2026-11-10T00:00:00Z" } } }),
      rawCommit({ sha: "not-a-sha" }),
      rawCommit({ commit: { message: "m", committer: { date: "bad" } } }),
      rawCommit({ author: null, commit: { message: "m", author: { email: "b@x.io", date: "2026-11-08T00:00:00Z" } } }),
      null,
    ]);

    expect(picked).toHaveLength(2);
    expect(picked[0]?.message).toHaveLength(2000);
    expect(picked[0]).toMatchObject({ sha: SHA, authorLogin: "alice", committedAt: "2026-11-10T00:00:00Z" });
    expect(picked[1]).toMatchObject({ authorLogin: null, authorEmail: "b@x.io", committedAt: "2026-11-08T00:00:00Z" });
    expect(pickCommits("x")).toEqual([]);
  });

  it("[SG-100] PR 은 제목을 500자로 자르고 번호가 이상한 항목은 건너뛴다", () => {
    const picked = pickPulls([
      { number: 7, title: "t".repeat(900), state: "open", updated_at: "2026-11-10T00:00:00Z", html_url: "u", user: { login: "bob" } },
      { number: "8", title: "x" },
      { number: -1, title: "x" },
    ]);

    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ number: 7, state: "open", authorLogin: "bob", url: "u" });
    expect(picked[0]?.title).toHaveLength(500);
  });
});

describe("커밋·PR 조회 (fetch mock)", () => {
  it("[SG-101] listRecentCommits 는 sha·since·per_page=100 으로 1쪽만, 409·404 는 []", async () => {
    const mock = createFetchMock(({ url }) => {
      if (url.pathname === "/repos/my-org/svc/commits") return { status: 200, body: [rawCommit()] };
      if (url.pathname === "/repos/my-org/empty/commits") return { status: 409, body: { message: "Git Repository is empty." } };
      return { status: 404, body: { message: "Not Found" } };
    });
    const github = createOctokitClient({ token: "t", fetch: mock.fetch });

    const found = await github.listRecentCommits("my-org", "svc", "main", SINCE);

    expect(found).toHaveLength(1);
    expect(mock.calls).toHaveLength(1);
    const query = mock.calls[0]?.url.searchParams;
    expect(query?.get("sha")).toBe("main");
    expect(query?.get("since")).toBe(SINCE);
    expect(query?.get("per_page")).toBe("100");
    expect(query?.get("path")).toBeNull();
    expect(await github.listRecentCommits("my-org", "empty", "main", SINCE)).toEqual([]);
    expect(await github.listRecentCommits("my-org", "none", "main", SINCE)).toEqual([]);
  });

  it("[SG-101] listWorkflowCommits 는 path=.github/workflows 를 더하고 필요한 필드만 돌려준다", async () => {
    const mock = createFetchMock(() => ({ status: 200, body: [rawCommit()] }));
    const github = createOctokitClient({ token: "t", fetch: mock.fetch });

    const found = await github.listWorkflowCommits("my-org", "svc", "main", SINCE);

    expect(mock.calls[0]?.url.searchParams.get("path")).toBe(".github/workflows");
    expect(found).toEqual([
      { sha: SHA, committedAt: "2026-11-10T00:00:00Z", url: `https://github.com/my-org/svc/commit/${SHA}`, authorLogin: "alice" },
    ]);
  });

  it("[SG-101] listRecentPulls 는 state=all·updated desc·per_page=50 으로 1쪽만, 404 는 []", async () => {
    const mock = createFetchMock(({ url }) =>
      url.pathname === "/repos/my-org/svc/pulls"
        ? { status: 200, body: [{ number: 3, title: "docs", state: "closed", updated_at: "2026-11-10T00:00:00Z", html_url: "u", user: { login: "bob" } }] }
        : { status: 404, body: { message: "Not Found" } },
    );
    const github = createOctokitClient({ token: "t", fetch: mock.fetch });

    const found = await github.listRecentPulls("my-org", "svc");

    expect(found.map((pull) => pull.number)).toEqual([3]);
    const query = mock.calls[0]?.url.searchParams;
    expect(query?.get("state")).toBe("all");
    expect(query?.get("sort")).toBe("updated");
    expect(query?.get("direction")).toBe("desc");
    expect(query?.get("per_page")).toBe("50");
    expect(await github.listRecentPulls("my-org", "none")).toEqual([]);
  });

  it("[SG-101] 5xx 는 throw, primary rate limit 은 RateLimitedError", async () => {
    const limited = createFetchMock(() => ({
      status: 403,
      body: { message: "rate limit" },
      headers: { "x-ratelimit-remaining": "0" },
    }));
    const github = createOctokitClient({ token: "t", fetch: limited.fetch });

    await expect(github.listRecentPulls("my-org", "svc")).rejects.toMatchObject({ name: "RateLimitedError" });
    await expect(github.listRecentCommits("my-org", "svc", "main", SINCE)).rejects.toMatchObject({ name: "RateLimitedError" });
  });
});
