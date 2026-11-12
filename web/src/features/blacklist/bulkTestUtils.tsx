// 일괄 관리 화면 테스트 공용 헬퍼 (필터·선택·일괄 버튼·가져오기·내보내기).
import type { BlacklistEntry } from "@pw/shared";
import {
  blacklistEntries,
  blacklistEntryVariants,
  emptyFindingsPage,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { DashboardPage } from "@/features/findings/DashboardPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { findRowWith } from "@/test/ui";

export const BLACKLIST = "/api/blacklist";
export const BULK = "/api/blacklist/bulk";
export const IMPORT = "/api/blacklist/import";
export const FINDINGS = "/api/findings";
export const SUMMARY = "/api/summary";

/** 화면에 보이는 전체 항목 (lodash, evil-pkg, paused-pkg, old-advisory, stale-pkg, @typosquat/*). */
export const ALL_ITEMS: BlacklistEntry[] = [...blacklistEntries, ...blacklistEntryVariants];

export function setupServer(items: BlacklistEntry[] = ALL_ITEMS): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items }))
    .on("GET", FINDINGS, reply.json(emptyFindingsPage))
    .on("GET", SUMMARY, reply.json(summaryDefault));
}

/** withDashboard: findings·summary 를 구독하는 대시보드를 함께 렌더해 무효화를 재요청으로 관찰한다. */
export async function renderBlacklist({ withDashboard = false } = {}) {
  const result = renderWithProviders(
    <>
      <BlacklistPage />
      {withDashboard && <DashboardPage />}
    </>,
    { route: "/blacklist" },
  );
  await findRowWith("lodash");
  return result;
}

export function counts(server: FetchMock) {
  return {
    blacklist: server.count("GET", BLACKLIST),
    findings: server.count("GET", FINDINGS),
    summary: server.count("GET", SUMMARY),
  };
}

export function rowCheckbox(name: string): HTMLElement {
  return screen.getByRole("checkbox", { name: `${name} 선택` });
}

export function selectAllCheckbox(): HTMLElement {
  return screen.getByRole("checkbox", { name: "모두 선택" });
}

export async function selectRows(user: UserEvent, ...names: string[]) {
  for (const name of names) await user.click(rowCheckbox(name));
}

/** 일괄 버튼 줄. 행의 [삭제] 아이콘 버튼과 이름이 겹치므로 항상 이 안에서 찾는다. */
export function bulkBar(): HTMLElement {
  return screen.getByRole("group", { name: "일괄 작업" });
}

export function bulkButton(name: "켜기" | "끄기" | "삭제"): HTMLElement {
  return within(bulkBar()).getByRole("button", { name });
}
