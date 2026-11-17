// 취약점: 대시보드의 3번째 탭(패키지별 묶음 + 펼침 상세), "검출" 탭의 제외 조건, 요약 카드.
import {
  VULNERABILITY_DETAIL_MAX_FINDINGS,
  type Finding,
  type VulnerabilityDetail,
  type VulnerabilityGroup,
} from "@pw/shared";
import {
  apiErrorNotFound,
  emptyFindingsPage,
  findingOpenDirect,
  findingsPage,
  pageOf,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { advance, chooseOption, findRowWith } from "@/test/ui";
import { useLocation } from "react-router";

const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";
const SETTINGS = "/api/settings";
const LIST = "/api/vulnerabilities";
const DETAIL = "/api/vulnerabilities/detail";

const summary = { ...summaryDefault, openCount: 12, policyOpenCount: 7, cveOpenCount: 30 };

const lodash: VulnerabilityGroup = {
  ecosystem: "npm",
  packageName: "lodash",
  maxScore: 9.8,
  severity: "critical",
  advisoryCount: 2,
  repoCount: 3,
  findingCount: 4,
  hasDirect: true,
  patchedVersions: ["4.17.12", "4.17.21"],
};
const noScore: VulnerabilityGroup = {
  ecosystem: "pypi",
  packageName: "old-lib",
  maxScore: null,
  severity: "high",
  advisoryCount: 1,
  repoCount: 1,
  findingCount: 1,
  hasDirect: false,
  patchedVersions: [],
};

const cveFinding = (id: number, overrides: Partial<Finding> = {}): Finding => ({
  ...findingOpenDirect,
  id,
  repo: `repo-${id}`,
  source: "cve",
  blacklistEntryId: 700,
  ...overrides,
});

const lodashDetail: VulnerabilityDetail = {
  ecosystem: "npm",
  packageName: "lodash",
  advisories: [
    {
      blacklistEntryId: 700,
      externalId: "GHSA-aaaa-bbbb-cccc",
      cvssScore: 9.8,
      severity: "critical",
      summary: "Command injection in lodash",
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      versionRange: "<4.17.21",
      patchedVersion: "4.17.21",
      findingCount: 4,
    },
    {
      blacklistEntryId: 701,
      externalId: "GHSA-dddd-eeee-ffff",
      cvssScore: null,
      severity: "high",
      summary: "Prototype pollution in lodash",
      url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
      versionRange: null,
      patchedVersion: null,
      findingCount: 1,
    },
  ],
  findings: [
    cveFinding(11, { repo: "api", ref: "", filePath: "package-lock.json", version: "4.17.20", dependencyType: "direct" }),
    cveFinding(12, {
      repo: "web",
      ref: "release/2",
      filePath: "frontend/yarn.lock",
      version: "4.17.15",
      dependencyType: "transitive",
      htmlUrl: "https://github.com/my-org/web/blob/release/2/frontend/yarn.lock",
    }),
  ],
  findingsTotal: 2,
};

interface ServerOptions {
  list?: ReplyFactory;
  detail?: ReplyFactory;
  settings?: typeof settingsDefault;
}

function setupServer(opts: ServerOptions = {}): FetchMock {
  return setupFetchMock()
    .on("GET", SUMMARY, reply.json(summary))
    .on("GET", FINDINGS, (request) => reply.json(pageOf(findingsPage.items, { total: 12 }))(request))
    .on("GET", SETTINGS, reply.json(opts.settings ?? settingsDefault))
    .on("GET", LIST, opts.list ?? reply.json(pageOf([lodash, noScore])))
    .on("GET", DETAIL, opts.detail ?? reply.json(lodashDetail));
}

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderDashboard(route = "/?tab=cve") {
  return renderWithProviders(
    <>
      <DashboardPage />
      <Search />
    </>,
    { route },
  );
}

const lastList = (server: FetchMock) => server.last("GET", LIST)?.query;

describe("취약점 탭", () => {
  it("[SI-50] 탭 이름 옆에 cveOpenCount 가 있고, 누르면 tab=cve 와 취약점 목록 요청(page=1, limit=50)을 한다", async () => {
    const server = setupServer();
    const { user } = renderDashboard("/");
    const tab = await screen.findByRole("tab", { name: "취약점 (30)" });
    expect(tab).toHaveAttribute("aria-selected", "false");
    await user.click(tab);
    await findRowWith("lodash");
    expect(screen.getByTestId("search").textContent).toBe("?tab=cve");
    expect(lastList(server)).toEqual({ page: "1", limit: "50" });
    expect(screen.getByRole("tab", { name: "취약점 (30)" })).toHaveAttribute("aria-selected", "true");
  });

  it("[SI-51] 표는 패키지별 1줄이고 종류·점수·권고·repo·검출·고쳐진 버전·직접을 보인다", async () => {
    setupServer();
    renderDashboard();
    const row = await findRowWith("lodash");
    const table = screen.getByRole("table", { name: "취약점 목록" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual([
      "종류",
      "패키지",
      "최고 점수",
      "권고",
      "repo",
      "검출",
      "고쳐진 버전",
      "직접 의존성",
    ]);
    expect(within(row).getByText("npm")).toBeInTheDocument();
    expect(within(row).getByText("9.8")).toBeInTheDocument();
    expect(within(row).getByText("critical")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("4.17.12, 4.17.21")).toBeInTheDocument();
    expect(within(row).getByText("직접")).toBeInTheDocument();
  });

  it("[SI-52] 점수·고쳐진 버전이 없으면 '—' 이고, 직접 의존성이 없으면 '직접' 표시가 없다", async () => {
    setupServer();
    renderDashboard();
    const row = await findRowWith("old-lib");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(within(row).getByText("high")).toBeInTheDocument();
    expect(within(row).queryByText("직접")).not.toBeInTheDocument();
  });

  it("[SI-53] 필터: 종류(패키지 분류만)·패키지 검색(300ms debounce, trim)·직접 의존성만 → 요청 파라미터와 page=1", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer({ list: reply.json(pageOf([lodash, noScore], { total: 120 })) });
    const { user } = renderDashboard();
    await findRowWith("lodash");

    await user.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(lastList(server)?.page).toBe("2"));

    await user.click(screen.getByRole("combobox", { name: "종류" }));
    const listbox = await screen.findByRole("listbox");
    const groups = within(listbox)
      .getAllByRole("group")
      .map((g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent?.trim());
    expect(groups).toEqual(["패키지"]);
    await user.click(within(listbox).getByRole("option", { name: "go" }));
    await waitFor(() => expect(lastList(server)).toEqual({ ecosystem: "go", page: "1", limit: "50" }));

    const before = server.count("GET", LIST);
    await user.type(screen.getByRole("textbox", { name: "패키지" }), "  lo ");
    expect(server.count("GET", LIST)).toBe(before);
    await advance(350);
    await waitFor(() => expect(lastList(server)).toEqual({ ecosystem: "go", q: "lo", page: "1", limit: "50" }));

    await user.click(screen.getByRole("switch", { name: "직접 의존성만" }));
    await waitFor(() =>
      expect(lastList(server)).toEqual({ ecosystem: "go", q: "lo", directOnly: "true", page: "1", limit: "50" }),
    );
    await user.click(screen.getByRole("switch", { name: "직접 의존성만" }));
    await waitFor(() => expect(lastList(server)).toEqual({ ecosystem: "go", q: "lo", page: "1", limit: "50" }));
  });

  it("[SI-54] 쪽 나눔: [다음] 으로 page 를 옮기고 N–M / total 을 보인다", async () => {
    const server = setupServer({
      list: (request) => reply.json(pageOf([lodash], { total: 120, page: Number(request.query.page ?? "1") }))(request),
    });
    const { user } = renderDashboard();
    await screen.findByText("1–50 / 120");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("51–100 / 120");
    expect(lastList(server)).toEqual({ page: "2", limit: "50" });
  });

  it("[SI-55] 행을 열기 전에는 상세를 요청하지 않고, 펼침 버튼의 aria-expanded 가 바뀌며, 열면 그때 조회한다", async () => {
    const server = setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    expect(server.count("GET", DETAIL)).toBe(0);

    const button = screen.getByRole("button", { name: "lodash" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await screen.findByText("Command injection in lodash");
    expect(server.count("GET", DETAIL)).toBe(1);
    expect(server.last("GET", DETAIL)?.query).toEqual({ ecosystem: "npm", name: "lodash" });

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Command injection in lodash")).not.toBeInTheDocument();
  });

  it("[SI-56] 상세의 권고: GHSA 는 새 탭 링크(rel=noopener noreferrer)이고 점수·요약·범위·고쳐진 버전·검출 수를 보인다", async () => {
    setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    const table = await screen.findByRole("table", { name: "lodash 권고 목록" });
    const first = within(table).getByRole("link", { name: /GHSA-aaaa-bbbb-cccc/ });
    expect(first).toHaveAttribute("href", "https://github.com/advisories/GHSA-aaaa-bbbb-cccc");
    expect(first).toHaveAttribute("target", "_blank");
    expect(first).toHaveAttribute("rel", "noopener noreferrer");

    const row = await findRowWith("GHSA-aaaa-bbbb-cccc", table);
    expect(within(row).getByText("9.8")).toBeInTheDocument();
    expect(within(row).getByText("Command injection in lodash")).toBeInTheDocument();
    expect(within(row).getByText("<4.17.21")).toBeInTheDocument();
    expect(within(row).getByText("4.17.21")).toBeInTheDocument();
    const noRange = await findRowWith("GHSA-dddd-eeee-ffff", table);
    expect(within(noRange).getByText("모든 버전")).toBeInTheDocument();
    expect(within(noRange).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("[SI-57] 상세에 '이 권고를 무시' 동작은 없고, 블랙리스트에서 끄면 org 전체에서 대조하지 않는다는 안내가 있다", async () => {
    setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    await screen.findByText("Command injection in lodash");
    expect(screen.getByText("블랙리스트에서 그 항목을 끄면 org 전체에서 대조하지 않습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /무시/ })).not.toBeInTheDocument();
  });

  it("[SI-58] 상세의 영향받는 검출: repo·브랜치(ref 가 있을 때)·파일 링크·버전·직접/전이", async () => {
    setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    const table = await screen.findByRole("table", { name: "lodash 영향받는 검출 목록" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim())).toEqual([
      "repo",
      "브랜치",
      "파일",
      "버전",
      "직접/전이",
    ]);
    const base = await findRowWith("api", table);
    expect(within(base).queryByText("release/2")).not.toBeInTheDocument();
    expect(within(base).getByText("4.17.20")).toBeInTheDocument();
    expect(within(base).getByText("직접")).toBeInTheDocument();
    const link = within(base).getByRole("link", { name: /package-lock\.json/ });
    expect(link).toHaveAttribute("href", findingOpenDirect.htmlUrl);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    const branch = await findRowWith("web", table);
    expect(within(branch).getByText("release/2")).toBeInTheDocument();
    expect(within(branch).getByText("4.17.15")).toBeInTheDocument();
    expect(within(branch).getByText("전이")).toBeInTheDocument();
    expect(within(branch).getByRole("link", { name: /frontend\/yarn\.lock/ })).toHaveAttribute(
      "href",
      "https://github.com/my-org/web/blob/release/2/frontend/yarn.lock",
    );
  });

  it("[SI-59] findingsTotal 이 목록보다 크면 'n건 중 500건을 표시' 를 안내하고, 같으면 안내가 없다", async () => {
    const many = Array.from({ length: VULNERABILITY_DETAIL_MAX_FINDINGS }, (_, index) => cveFinding(1000 + index));
    setupServer({ detail: reply.json({ ...lodashDetail, findings: many, findingsTotal: 812 }) });
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    expect(await screen.findByText("812건 중 500건을 표시합니다")).toBeInTheDocument();
  });

  it("[SI-60] 안내가 없는 경우: 검출이 모두 보이면 '건 중' 문구가 없다", async () => {
    setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    await screen.findByText("Command injection in lodash");
    expect(screen.queryByText(/건 중/)).not.toBeInTheDocument();
  });

  it("[SI-61] 상세 조회가 404 이면 더는 취약점이 없다는 문장을, 실패하면 [다시 시도] 를 보인다", async () => {
    const server = setupServer({ detail: reply.error(apiErrorNotFound) });
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    expect(await screen.findByText("이 패키지의 취약점이 더는 없습니다")).toBeInTheDocument();
    expect(server.count("GET", DETAIL)).toBe(1);
  });

  it("[SI-62] 상세 조회가 실패하면 오류 문장과 [다시 시도] 를 보이고, 다시 시도하면 상세를 보인다", async () => {
    let fail = true;
    setupServer({ detail: (request) => (fail ? reply.text("x", 500)(request) : reply.json(lodashDetail)(request)) });
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("button", { name: "lodash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("데이터를 불러오지 못했습니다");
    fail = false;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("Command injection in lodash")).toBeInTheDocument();
  });

  it("[SI-63] 0건이고 cveMinScore=0 이면 대조가 꺼져 있다는 안내를 보인다", async () => {
    setupServer({ list: reply.json(pageOf<VulnerabilityGroup>([])), settings: { ...settingsDefault, cveMinScore: 0 } });
    renderDashboard();
    expect(
      await screen.findByText("취약점의 대조가 꺼져 있습니다. 설정에서 기준 점수를 정하십시오"),
    ).toBeInTheDocument();
  });

  it("[SI-64] 0건이고 기준 점수가 켜져 있으면 '기준 이상의 취약점이 없습니다' 를 보인다", async () => {
    setupServer({ list: reply.json(pageOf<VulnerabilityGroup>([])) });
    renderDashboard();
    expect(await screen.findByText("기준 이상의 취약점이 없습니다")).toBeInTheDocument();
  });

  it("[SI-65] 필터가 있고 0건이면 '조건에 맞는 취약점이 없습니다' 를 보인다", async () => {
    setupServer({
      list: (request) => reply.json(pageOf(request.query.q ? [] : [lodash]))(request),
    });
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.type(screen.getByRole("textbox", { name: "패키지" }), "zzz");
    expect(await screen.findByText("조건에 맞는 취약점이 없습니다")).toBeInTheDocument();
  });

  it("[SI-66] loading 은 불러오는 중 상태, 첫 로드 실패는 [다시 시도] 로 다시 받는다", async () => {
    let fail = true;
    const server = setupServer({ list: (request) => (fail ? reply.text("x", 500)(request) : reply.json(pageOf([lodash]))(request)) });
    const { user } = renderDashboard();
    expect(await screen.findByRole("alert")).toHaveTextContent("데이터를 불러오지 못했습니다");
    fail = false;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await findRowWith("lodash");
    expect(server.count("GET", LIST)).toBeGreaterThanOrEqual(2);
  });

  it("[SI-67] 첫 응답 전에는 '불러오는 중' 상태를 보인다", async () => {
    setupFetchMock()
      .on("GET", SUMMARY, reply.json(summary))
      .on("GET", FINDINGS, reply.json(emptyFindingsPage))
      .on("GET", LIST, () => new Promise<Response>(() => undefined));
    renderDashboard();
    const statuses = await screen.findAllByRole("status");
    expect(statuses.some((status) => status.textContent === "불러오는 중")).toBe(true);
  });
});

describe("취약점 — 다른 탭과 카드", () => {
  it("[SI-68] '검출' 탭 요청에 excludeSource=cve 가 붙고, 탭의 내용과 수는 그대로다", async () => {
    const server = setupServer();
    renderDashboard("/");
    await findRowWith("api");
    expect(server.requests("GET", FINDINGS)[0]?.query).toEqual({
      status: "open",
      excludeCategory: "policy",
      excludeSource: "cve",
      page: "1",
      limit: "50",
    });
    expect(await screen.findByRole("tab", { name: "검출 (12)" })).toHaveAttribute("aria-selected", "true");
    expect(server.count("GET", LIST)).toBe(0);
  });

  it("[SI-69] 요약 카드 '취약점 n건' 은 취약점 탭으로 가는 링크다", async () => {
    setupServer();
    const { user } = renderDashboard("/");
    const card = await screen.findByRole("link", { name: /취약점/ });
    await waitFor(() => expect(card).toHaveTextContent("30건"));
    expect(card).toHaveAttribute("href", "/?tab=cve");
    await user.click(card);
    await findRowWith("lodash");
    expect(screen.getByTestId("search").textContent).toBe("?tab=cve");
  });

  it("[SI-70] 탭을 바꿔도 취약점 탭의 필터가 유지된다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    const { user } = renderDashboard();
    await findRowWith("lodash");
    await user.click(screen.getByRole("switch", { name: "직접 의존성만" }));
    await waitFor(() => expect(lastList(server)?.directOnly).toBe("true"));
    await user.click(screen.getByRole("tab", { name: /^검출/ }));
    await findRowWith("api");
    await user.click(screen.getByRole("tab", { name: /^취약점/ }));
    await findRowWith("lodash");
    expect(screen.getByRole("switch", { name: "직접 의존성만" })).toBeChecked();
    expect(lastList(server)?.directOnly).toBe("true");
    await act(async () => undefined);
    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "npm");
    await waitFor(() => expect(lastList(server)).toMatchObject({ ecosystem: "npm", directOnly: "true", page: "1" }));
  });
});
