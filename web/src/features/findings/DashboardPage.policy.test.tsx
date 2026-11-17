// 묶음 D: 대시보드의 "위험한 설정" 탭과 요약 카드.
import { POLICY_CHECKS, type BlacklistEntry, type Finding } from "@pw/shared";
import {
  blacklistEntryPattern,
  findingOpenDirect,
  findingsPage,
  pageOf,
  summaryDefault,
} from "@pw/shared/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { advance, chooseOption, findRowWith, findToast } from "@/test/ui";

const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";
const BLACKLIST = "/api/blacklist";

const summary = { ...summaryDefault, openCount: 12, policyOpenCount: 7 };
const unpinned = POLICY_CHECKS[0];
const policyEntry: BlacklistEntry = {
  ...blacklistEntryPattern,
  id: 91,
  ecosystem: "policy",
  name: unpinned.id,
  versionRange: null,
  reason: unpinned.description,
};
const policyFinding: Finding = {
  ...findingOpenDirect,
  id: 501,
  repo: "infra",
  filePath: ".github/workflows/ci.yml",
  ecosystem: "policy",
  packageName: "some-org/some-action",
  version: "v1",
  dependencyType: "direct",
  blacklistEntryId: policyEntry.id,
  reason: unpinned.description,
  htmlUrl: "https://github.com/my-org/infra/blob/HEAD/.github/workflows/ci.yml",
};
const policyNoVersion: Finding = {
  ...policyFinding,
  id: 502,
  repo: "tools",
  packageName: "permissions",
  version: "",
};

const byCategory: ReplyFactory = (request) => {
  const page = Number(request.query.page ?? "1");
  if (request.query.category === "policy") {
    return reply.json(pageOf([policyFinding, policyNoVersion], { total: 2, page, limit: 50 }))(request);
  }
  return reply.json(pageOf(findingsPage.items, { total: 120, page, limit: 50 }))(request);
};

function setupServer(opts: { blacklistFails?: boolean } = {}): FetchMock {
  return setupFetchMock()
    .on("GET", SUMMARY, reply.json(summary))
    .on("GET", FINDINGS, byCategory)
    .on(
      "GET",
      BLACKLIST,
      opts.blacklistFails ? reply.text("x", 500) : reply.json({ items: [policyEntry] }),
    )
    .on("PATCH", /\/api\/findings\/\d+/, reply.json({ ...policyFinding, status: "ignored" }));
}

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderDashboard(route = "/") {
  return renderWithProviders(
    <>
      <DashboardPage />
      <Search />
    </>,
    { route },
  );
}
const search = () => screen.getByTestId("search").textContent;
const queries = (server: FetchMock) => server.requests("GET", FINDINGS).map((r) => r.query);

describe("대시보드 — 탭", () => {
  it("[SD-60] 탭 2개, 라벨에 건수. 기본은 검출이고 목록 요청에 excludeCategory=policy 가 붙는다", async () => {
    const server = setupServer();
    renderDashboard();
    const tablist = screen.getByRole("tablist");
    const detections = await within(tablist).findByRole("tab", { name: "검출 (12)" });
    expect(await within(tablist).findByRole("tab", { name: "위험한 설정 (7)" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(detections).toHaveAttribute("aria-selected", "true");
    await findRowWith("api");
    expect(queries(server)[0]).toEqual({ status: "open", excludeCategory: "policy", excludeSource: "cve", page: "1", limit: "50" });
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("검출 (12)");
  });

  it("[SD-61] 검출 탭의 종류 select 에는 위험한 설정 그룹이 없다", async () => {
    setupServer();
    const { user } = renderDashboard();
    await findRowWith("api");
    await user.click(screen.getByRole("combobox", { name: "종류" }));
    const listbox = await screen.findByRole("listbox");
    const labels = within(listbox)
      .getAllByRole("group")
      .map((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent?.trim());
    expect(labels).toEqual(["패키지", "CI·이미지", "침해의 흔적"]);
    expect(within(listbox).queryByRole("option", { name: "위험한 설정" })).toBeNull();
  });

  it("[SD-62] 위험한 설정 탭: URL 에 tab=policy, category=policy 로 요청하고 열은 검사 | repo | 파일 | 대상 | 심각도 | 상태 | 처음 본 시각 | 동작", async () => {
    const server = setupServer();
    const { user } = renderDashboard();
    await user.click(await screen.findByRole("tab", { name: "위험한 설정 (7)" }));
    await findRowWith("infra");
    expect(search()).toBe("?tab=policy");
    expect(queries(server).at(-1)).toEqual({ status: "open", category: "policy", page: "1", limit: "50" });
    const table = screen.getByRole("table", { name: "위험한 설정 목록" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual([
      "검사",
      "repo",
      "파일",
      "대상",
      "심각도",
      "상태",
      "처음 본 시각",
      "동작",
    ]);
    const row = await findRowWith("infra");
    expect(within(row).getByText(unpinned.title)).toBeInTheDocument();
    expect(within(row).getByText(".github/workflows/ci.yml")).toBeInTheDocument();
    expect(within(row).getByText("some-org/some-action@v1")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "행 메뉴" })).toBeInTheDocument();
  });

  it("[SD-63] 값이 없는 대상은 packageName 만 표시하고, 블랙리스트를 못 받으면 검사 이름은 \"위험한 설정\"", async () => {
    setupServer({ blacklistFails: true });
    renderDashboard("/?tab=policy");
    const row = await findRowWith("tools");
    expect(within(row).getByText("permissions")).toBeInTheDocument();
    expect(within(row).getByText("위험한 설정")).toBeInTheDocument();
    expect(within(row).queryByText(unpinned.title)).toBeNull();
  });

  it("[SD-64] 위험한 설정 탭의 필터: 상태·심각도·repo 만 있고 종류·패키지는 없다. 검출이 없으면 빈 문구", async () => {
    const server = setupServer();
    server.on("GET", FINDINGS, reply.json(pageOf<Finding>([], { total: 0 })));
    renderDashboard("/?tab=policy");
    expect(await screen.findByText("위험한 설정이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "상태" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "심각도" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "repo" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "종류" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "패키지" })).toBeNull();
  });

  it("[SD-65] 탭은 좌우 화살표로 이동하고, tabpanel 이 탭과 연결된다", async () => {
    setupServer();
    const { user } = renderDashboard();
    const first = await screen.findByRole("tab", { name: "검출 (12)" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    const second = screen.getByRole("tab", { name: "위험한 설정 (7)" });
    await waitFor(() => expect(second).toHaveAttribute("aria-selected", "true"));
    expect(search()).toBe("?tab=policy");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("위험한 설정 (7)");
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(first).toHaveAttribute("aria-selected", "true"));
    expect(search()).toBe("");
  });

  it("[SD-66] page 는 탭마다 유지된다: 검출 2페이지 → 위험한 설정 → 돌아오면 2페이지", async () => {
    const server = setupServer();
    const { user } = renderDashboard();
    await findRowWith("api");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(queries(server).at(-1)?.page).toBe("2"));
    await user.click(screen.getByRole("tab", { name: "위험한 설정 (7)" }));
    await findRowWith("infra");
    expect(queries(server).at(-1)).toMatchObject({ category: "policy", page: "1" });
    await user.click(screen.getByRole("tab", { name: "검출 (12)" }));
    await waitFor(() => {
      const last = queries(server).at(-1);
      expect(last?.excludeCategory).toBe("policy");
      expect(last?.page).toBe("2");
    });
  });

  it("[SD-67] 위험한 설정 탭에서 무시하면 목록과 summary 를 다시 읽고 탭의 건수·카드가 새 값이 된다", async () => {
    let current = summary;
    const server = setupServer().on("GET", SUMMARY, (request) => reply.json(current)(request));
    const { user } = renderDashboard("/?tab=policy");
    await findRowWith("infra");
    const before = { f: server.count("GET", FINDINGS), s: server.count("GET", SUMMARY) };
    current = { ...summary, policyOpenCount: 6 };
    await user.click(within(await findRowWith("infra")).getByRole("button", { name: "행 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "무시" }));
    await findToast("상태를 변경했습니다");
    expect(server.last("PATCH", /\/api\/findings\/501/)?.body).toEqual({ status: "ignored" });
    await waitFor(() => {
      expect(server.count("GET", FINDINGS)).toBeGreaterThan(before.f);
      expect(server.count("GET", SUMMARY)).toBeGreaterThan(before.s);
    });
    expect(await screen.findByRole("tab", { name: "위험한 설정 (6)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /위험한 설정.*6건/ })).toBeInTheDocument();
  });

  it("[SD-70] 알 수 없는 tab 값은 검출 탭이다", async () => {
    setupServer();
    renderDashboard("/?tab=garbage");
    expect(await screen.findByRole("tab", { name: "검출 (12)" })).toHaveAttribute("aria-selected", "true");
  });

  it("[SD-71] 비활성 탭의 목록은 요청하지 않는다", async () => {
    const server = setupServer();
    renderDashboard();
    await findRowWith("api");
    expect(queries(server).filter((q) => q.category === "policy")).toHaveLength(0);
  });

  it("[SD-72] 검출 탭에서 종류를 고르면 ecosystem 과 excludeCategory=policy 가 함께 간다", async () => {
    const server = setupServer();
    const { user } = renderDashboard();
    await findRowWith("api");
    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "go");
    await waitFor(() => expect(queries(server).at(-1)).toMatchObject({ ecosystem: "go", excludeCategory: "policy" }));
  });

  it("[SD-73] 필터는 탭마다 독립이다: 검출 탭의 repo 검색어가 위험한 설정 탭의 요청에 없다", async () => {
    const server = setupServer();
    const { user } = renderDashboard();
    await findRowWith("api");
    await user.type(screen.getByRole("textbox", { name: "repo" }), "api");
    await waitFor(() => expect(queries(server).at(-1)?.repo).toBe("api"));
    await user.click(screen.getByRole("tab", { name: "위험한 설정 (7)" }));
    await findRowWith("infra");
    const last = queries(server).at(-1);
    expect(last?.category).toBe("policy");
    expect(last?.repo).toBeUndefined();
    expect(screen.getByRole("textbox", { name: "repo" })).toHaveValue("");
  });

  it("[SD-74] 입력 직후 부모가 다시 렌더돼도 300ms 뒤에 요청은 1번 나간다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 두 번째 응답부터 건수가 달라서 부모가 실제로 다시 렌더된다.
      let calls = 0;
      const server = setupServer().on("GET", SUMMARY, (request) =>
        reply.json({ ...summary, policyOpenCount: 7 + calls++ })(request),
      );
      const { user, queryClient } = renderDashboard();
      await findRowWith("api");
      const before = queries(server).length;
      await user.type(screen.getByRole("textbox", { name: "repo" }), "ap");
      await advance(200);
      // summary 갱신 → 부모 re-render
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["summary"] });
      });
      // 입력 후 350ms: re-render 가 타이머를 다시 시작했다면 아직 요청이 없다.
      await advance(150);
      expect(screen.getByRole("tab", { name: /^위험한 설정 \(\d+\)$/ }).textContent).not.toBe("위험한 설정 (7)");
      expect(queries(server).slice(before)).toHaveLength(1);
      expect(queries(server).at(-1)?.repo).toBe("ap");
    } finally {
      vi.useRealTimers();
    }
  });

});

describe("대시보드 — 요약 카드", () => {
  it("[SD-68] \"위험한 설정 7건\" 카드를 누르면 위험한 설정 탭으로 간다. 기존 카드의 숫자는 그대로", async () => {
    setupServer();
    const { user } = renderDashboard();
    const card = await screen.findByRole("link", { name: /위험한 설정.*7건/ });
    expect(card).toHaveAttribute("href", "/?tab=policy");
    const cards = screen.getByRole("region", { name: "요약" });
    expect(within(cards).getByText("12")).toBeInTheDocument();
    expect(within(cards).getByText("ignored")).toBeInTheDocument();
    await user.click(card);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "위험한 설정 (7)" })).toHaveAttribute("aria-selected", "true"),
    );
    expect(search()).toBe("?tab=policy");
  });
});
