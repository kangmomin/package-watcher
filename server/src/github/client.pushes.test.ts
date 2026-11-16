import { describe, expect, it } from "vitest";
import { createFetchMock } from "../test/fetchMock.ts";
import { createOctokitClient, pickRecentPushes } from "./client.ts";

const SINCE = "2026-11-05T00:00:00.000Z";
const ev = (type: string, ref: string, at: string, refType = "branch") => ({
  type,
  created_at: at,
  payload: { ref: type === "PushEvent" ? `refs/heads/${ref}` : ref, ref_type: refType },
});

describe("pickRecentPushes — 삭제와 요청 수", () => {
  it("[SH-44] 마지막 push 보다 뒤에 삭제된 브랜치는 뺀다. 삭제 뒤에 다시 push 했으면 남는다", () => {
    const picked = pickRecentPushes(
      [
        ev("DeleteEvent", "gone", "2026-11-11T00:00:00Z"),
        ev("PushEvent", "gone", "2026-11-10T00:00:00Z"),
        ev("PushEvent", "back", "2026-11-11T00:00:00Z"),
        ev("DeleteEvent", "back", "2026-11-10T00:00:00Z"),
        ev("DeleteEvent", "only-deleted", "2026-11-10T00:00:00Z"),
        ev("DeleteEvent", "v1", "2026-11-10T00:00:00Z", "tag"),
      ],
      SINCE,
    );

    expect([...picked.keys()]).toEqual(["back"]);
  });

  it("[SH-45] octokit 클라이언트는 보낸 HTTP 요청을 REST 와 GraphQL 로 센다", async () => {
    const mock = createFetchMock(({ url }) =>
      url.pathname === "/graphql"
        ? { status: 200, body: { data: { repository: { defaultBranchRef: null, refs: { nodes: [] } } } } }
        : { status: 200, body: [] },
    );
    const github = createOctokitClient({ token: "test-token", fetch: mock.fetch });

    await github.listRecentBranches("my-org", "svc", SINCE);
    await github.listRecentPushes("my-org", "svc", SINCE);
    await github.listRecentPushes("my-org", "svc", SINCE);

    expect(github.requestCounts?.()).toEqual({ rest: 2, graphql: 1 });
  });
});
