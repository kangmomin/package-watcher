// 취약점 탭의 리뷰 보강: 꺼짐 안내, 이름의 인코딩, 동시 펼침, 펼침 초기화, 다시 조회한 404.
import type { VulnerabilityDetail, VulnerabilityGroup } from "@pw/shared";
import {
  apiErrorNotFound,
  emptyFindingsPage,
  findingOpenDirect,
  pageOf,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { findRowWith } from "@/test/ui";

const LIST = "/api/vulnerabilities";
const DETAIL = "/api/vulnerabilities/detail";

const lodash: VulnerabilityGroup = {
  ecosystem: "npm",
  packageName: "lodash",
  maxScore: 9.8,
  severity: "critical",
  advisoryCount: 1,
  repoCount: 1,
  findingCount: 1,
  hasDirect: true,
  patchedVersions: ["4.17.21"],
};
const oldLib: VulnerabilityGroup = { ...lodash, ecosystem: "pypi", packageName: "old-lib", hasDirect: false };

const detailOf = (group: VulnerabilityGroup, summary: string): VulnerabilityDetail => ({
  ecosystem: group.ecosystem,
  packageName: group.packageName,
  advisories: [
    {
      blacklistEntryId: 700,
      externalId: "GHSA-aaaa-bbbb-cccc",
      cvssScore: 9.8,
      severity: "critical",
      summary,
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      versionRange: "<4.17.21",
      patchedVersion: "4.17.21",
      findingCount: 1,
    },
  ],
  findings: [{ ...findingOpenDirect, id: 11, source: "cve", blacklistEntryId: 700 }],
  findingsTotal: 1,
});

interface ServerOptions {
  list?: ReplyFactory;
  detail?: ReplyFactory;
  feedEnabled?: boolean;
}

function setupServer(opts: ServerOptions = {}): FetchMock {
  return setupFetchMock()
    .on("GET", "/api/summary", reply.json({ ...summaryDefault, cveOpenCount: 2 }))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/settings", reply.json({ ...settingsDefault, feedEnabled: opts.feedEnabled ?? true }))
    .on("GET", LIST, opts.list ?? reply.json(pageOf([lodash, oldLib])))
    .on(
      "GET",
      DETAIL,
      opts.detail ??
        ((request) =>
          reply.json(
            request.query.name === "old-lib"
              ? detailOf(oldLib, "Old lib flaw")
              : detailOf(lodash, "Command injection in lodash"),
          )(request)),
    );
}

const renderDashboard = () => renderWithProviders(<DashboardPage />, { route: "/?tab=cve" });
const toggleOf = (name: string) => screen.getByRole("button", { name });

describe("취약점 — 리뷰 보강", () => {
  it("[SI-91] 설정에서 외부 목록이 꺼져 있으면(feedEnabled=false) 꺼짐 안내를 보인다", async () => {
    setupServer({ list: reply.json(pageOf<VulnerabilityGroup>([])), feedEnabled: false });
    renderDashboard();
    expect(await screen.findByText("외부 목록이 꺼져 있습니다. 설정에서 켜십시오")).toBeInTheDocument();
  });

  it.each([
    ["@scope/pkg", "npm"],
    ["github.com/a/b", "go"],
  ] as const)("[SI-92] 상세 요청은 %s 를 query 로 올바르게 인코딩한다", async (name, ecosystem) => {
    const group: VulnerabilityGroup = { ...lodash, ecosystem, packageName: name };
    const server = setupServer({
      list: reply.json(pageOf([group])),
      detail: reply.json(detailOf(group, "Encoded flaw")),
    });
    const { user } = renderDashboard();
    await findRowWith(name);
    await user.click(toggleOf(name));
    await screen.findByText("Encoded flaw");
    const request = server.last("GET", DETAIL);
    expect(request?.query).toEqual({ ecosystem, name });
    expect(request?.url.search).toBe(`?ecosystem=${ecosystem}&name=${encodeURIComponent(name)}`);
    expect(request?.path).toBe(DETAIL);
  });

  it("[SI-93] 여러 행을 동시에 펼칠 수 있고 각각 따로 조회한다", async () => {
    const server = setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(toggleOf("lodash"));
    await user.click(toggleOf("old-lib"));
    expect(await screen.findByText("Command injection in lodash")).toBeInTheDocument();
    expect(await screen.findByText("Old lib flaw")).toBeInTheDocument();
    expect(toggleOf("lodash")).toHaveAttribute("aria-expanded", "true");
    expect(toggleOf("old-lib")).toHaveAttribute("aria-expanded", "true");
    expect(server.count("GET", DETAIL)).toBe(2);
  });

  it("[SI-94] 쪽이나 필터가 바뀌면 펼침 상태를 비운다", async () => {
    setupServer({ list: reply.json(pageOf([lodash, oldLib], { total: 120 })) });
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(toggleOf("lodash"));
    await screen.findByText("Command injection in lodash");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(toggleOf("lodash")).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByText("Command injection in lodash")).not.toBeInTheDocument();

    await user.click(toggleOf("lodash"));
    await screen.findByText("Command injection in lodash");
    await user.click(screen.getByRole("switch", { name: "직접 의존성만" }));
    await waitFor(() => expect(toggleOf("lodash")).toHaveAttribute("aria-expanded", "false"));
  });

  it("[SI-95] 열려 있는 상세를 다시 조회해서 404 가 오면 낡은 데이터 대신 더는 없다는 문장을 보인다", async () => {
    let gone = false;
    setupServer({
      detail: (request) =>
        gone ? reply.error(apiErrorNotFound)(request) : reply.json(detailOf(lodash, "Command injection in lodash"))(request),
    });
    const { user, queryClient } = renderDashboard();
    await findRowWith("lodash");
    await user.click(toggleOf("lodash"));
    await screen.findByText("Command injection in lodash");
    gone = true;
    await act(() => queryClient.invalidateQueries({ queryKey: ["vulnerabilities", "detail"] }));
    expect(await screen.findByText("이 패키지의 취약점이 더는 없습니다")).toBeInTheDocument();
    expect(screen.queryByText("Command injection in lodash")).not.toBeInTheDocument();
  });
});
