// v2(묶음 1/3) 대시보드: 표의 새 열(종류 = ecosystem, 심각도), 종류·심각도 필터.
// 근거: Integration Contract v2.2 의 UI State Contract, CT-18 의 FE 부분.
import { SEVERITIES, SUPPORTED_ECOSYSTEMS, type Finding } from "@pw/shared";
import {
  findingCritical,
  findingHigh,
  findingLow,
  findingOpenDirect,
  findingsBySeverity,
  findingsPage,
  pageOf,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock, type ReplyFactory } from "@/test/fetchMock";
import { ecosystemLabel } from "@/lib/format";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith, getRowWith } from "@/test/ui";

// ---- 테스트가 정한 UI 이름 (Plan 의 필터 이름을 label 로 쓴다)
const UI = {
  ecosystemFilter: "종류",
  severityFilter: "심각도",
} as const;

const TEXT = {
  all: "전체",
  next: "다음",
  direct: "직접",
  transitive: "전이",
} as const;

const FINDINGS = "/api/findings";
const SUMMARY = "/api/summary";

/** 열 순서: repo | 파일 경로 | 종류 | 패키지@버전 | 심각도 | 직접/전이 | 상태 | ⋮ */
const HEADERS = ["repo", "파일 경로", "종류", "패키지@버전", "심각도", "직접/전이", "상태"];
const COLUMN = { repo: 0, filePath: 1, ecosystem: 2, package: 3, severity: 4, dependencyType: 5, status: 6 } as const;

function makeFindings(count: number, firstId: number): Finding[] {
  return Array.from({ length: count }, (_, index) => {
    const id = firstId + index;
    return {
      ...findingOpenDirect,
      id,
      repo: `repo-${id}`,
      htmlUrl: `https://github.com/my-org/repo-${id}/blob/HEAD/package-lock.json`,
    };
  });
}

/** total 120, limit 50 의 3페이지 목록 */
const threePages: ReplyFactory = (request) => {
  const page = Number(request.query.page ?? "1");
  const items = makeFindings(page < 3 ? 50 : 20, (page - 1) * 50 + 1);
  return reply.json(pageOf(items, { total: 120, page, limit: 50 }))(request);
};

function setupServer(findings: ReplyFactory = reply.json(pageOf(findingsBySeverity))): FetchMock {
  return setupFetchMock().on("GET", SUMMARY, reply.json(summaryDefault)).on("GET", FINDINGS, findings);
}

function findingsQueries(server: FetchMock): Record<string, string>[] {
  return server.requests("GET", FINDINGS).map((request) => request.query);
}

function cellOf(repo: string, column: number): HTMLElement {
  const cell = Array.from(getRowWith(repo).querySelectorAll<HTMLElement>("th, td"))[column];
  if (!cell) throw new Error(`"${repo}" 행에 ${column}번 셀이 없습니다`);
  return cell;
}

function ecosystemFilter(): HTMLElement {
  return screen.getByRole("combobox", { name: UI.ecosystemFilter });
}

function severityFilter(): HTMLElement {
  return screen.getByRole("combobox", { name: UI.severityFilter });
}

/** 2페이지로 옮겨 둔다 (필터 변경이 page=1 로 되돌리는지 보기 위해). */
async function goToSecondPage(server: FetchMock, user: ReturnType<typeof renderWithProviders>["user"]) {
  await screen.findByText("1–50 / 120");
  await user.click(screen.getByRole("button", { name: TEXT.next }));
  await screen.findByText("51–100 / 120");
  expect(findingsQueries(server).at(-1)).toMatchObject({ page: "2" });
}

describe("대시보드 v2 — 검출 표", () => {
  it("[CT-18] 표의 열 순서는 repo | 파일 경로 | 종류 | 패키지@버전 | 심각도 | 직접/전이 | 상태 다 (v1 의 '종류' 는 '직접/전이' 로 바뀐다)", async () => {
    setupServer();
    renderWithProviders(<DashboardPage />);
    await findRowWith(findingCritical.repo);

    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    const texts = headers.map((header) => header.textContent?.trim() ?? "");
    expect(texts.slice(0, HEADERS.length)).toEqual(HEADERS);
    // 마지막은 행 메뉴(⋮) 열이다
    expect(texts).toHaveLength(HEADERS.length + 1);
  });

  it("[CT-18][v2-AC-03] 새 '종류' 열은 ecosystem 이고, 심각도는 배지(영문 값 그대로)로, 직접/전이는 그 뒤 열에 표시한다", async () => {
    setupServer(reply.json(pageOf([...findingsBySeverity, findingOpenDirect])));
    renderWithProviders(<DashboardPage />);
    await findRowWith(findingCritical.repo);

    for (const finding of [findingCritical, findingHigh, findingLow, findingOpenDirect]) {
      expect(cellOf(finding.repo, COLUMN.ecosystem)).toHaveTextContent(new RegExp(`^${finding.ecosystem}$`));
      const severity = cellOf(finding.repo, COLUMN.severity);
      expect(severity).toHaveTextContent(new RegExp(`^${finding.severity}$`));
      // 배지 = 색 + 텍스트 (shadcn Badge)
      expect(within(severity).getByText(finding.severity).closest('[data-slot="badge"]')).not.toBeNull();
    }
    expect(cellOf(findingCritical.repo, COLUMN.package)).toHaveTextContent("@typosquat/core@0.0.1");
    expect(cellOf(findingCritical.repo, COLUMN.dependencyType)).toHaveTextContent(TEXT.transitive);
    expect(cellOf(findingOpenDirect.repo, COLUMN.dependencyType)).toHaveTextContent(TEXT.direct);
    expect(cellOf(findingOpenDirect.repo, COLUMN.status)).toHaveTextContent("open");
  });
});

describe("대시보드 v2 — 종류·심각도 필터", () => {
  it("[CT-18] 종류·심각도 필터의 기본값은 '전체' 이고 초기 요청 URL 은 v1 그대로다 (두 파라미터 생략)", async () => {
    const server = setupServer(reply.json(findingsPage));
    renderWithProviders(<DashboardPage />);
    await findRowWith("api");

    expect(ecosystemFilter()).toHaveTextContent(TEXT.all);
    expect(severityFilter()).toHaveTextContent(TEXT.all);
    expect(findingsQueries(server)[0]).toEqual({ status: "open", page: "1", limit: "50" });
  });

  it("[CT-18] 필터 옵션: 종류 = 전체 + SUPPORTED_ECOSYSTEMS, 심각도 = 전체 + SEVERITIES(높은 순)", async () => {
    setupServer(reply.json(findingsPage));
    const { user } = renderWithProviders(<DashboardPage />);
    await findRowWith("api");

    const optionTexts = async () =>
      within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent?.trim() ?? "");

    await user.click(severityFilter());
    const severities = await optionTexts();
    expect(severities).toContain(TEXT.all);
    expect(severities.filter((text) => text !== TEXT.all)).toEqual([...SEVERITIES]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await user.click(ecosystemFilter());
    const ecosystems = await optionTexts();
    expect(ecosystems).toContain(TEXT.all);
    expect(ecosystems.filter((text) => text !== TEXT.all)).toEqual(SUPPORTED_ECOSYSTEMS.map(ecosystemLabel));
  });

  it("[CT-18][v2-AC-03] 심각도 필터를 바꾸면 severity= 와 page=1 로 다시 요청하고, '전체' 는 파라미터를 생략한다", async () => {
    const server = setupServer(threePages);
    const { user } = renderWithProviders(<DashboardPage />);
    await goToSecondPage(server, user);

    await chooseOption(user, severityFilter(), "high");
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "open", severity: "high", page: "1", limit: "50" }),
    );

    await chooseOption(user, severityFilter(), "critical");
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "open", severity: "critical", page: "1", limit: "50" }),
    );

    await chooseOption(user, severityFilter(), TEXT.all);
    await waitFor(() => expect(findingsQueries(server).at(-1)).toEqual({ status: "open", page: "1", limit: "50" }));
  });

  it("[CT-18] 종류 필터를 바꾸면 ecosystem= 과 page=1 로 다시 요청하고, '전체' 는 파라미터를 생략한다", async () => {
    const server = setupServer(threePages);
    const { user } = renderWithProviders(<DashboardPage />);
    await goToSecondPage(server, user);

    await chooseOption(user, ecosystemFilter(), "npm");
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "open", ecosystem: "npm", page: "1", limit: "50" }),
    );

    // 두 필터를 함께 쓴다
    await chooseOption(user, severityFilter(), "low");
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({
        status: "open",
        ecosystem: "npm",
        severity: "low",
        page: "1",
        limit: "50",
      }),
    );

    await chooseOption(user, ecosystemFilter(), TEXT.all);
    await waitFor(() =>
      expect(findingsQueries(server).at(-1)).toEqual({ status: "open", severity: "low", page: "1", limit: "50" }),
    );
  });
});
