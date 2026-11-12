import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router";
import { AppLayout } from "@/app/AppLayout";
import { renderWithProviders } from "@/test/render";

/** 페이지 대신 표시만 하는 본문으로 레이아웃을 렌더한다 (페이지의 API 호출 없이). */
function renderLayout(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="*" element={<p>본문</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe("AppLayout", () => {
  it.each([
    ["/", "대시보드 - Package Watcher"],
    ["/blacklist", "블랙리스트 - Package Watcher"],
    ["/scans", "스캔 이력 - Package Watcher"],
    ["/settings", "설정 - Package Watcher"],
  ])("%s 의 문서 제목은 '%s' 이다", (route, title) => {
    renderLayout(route);
    expect(document.title).toBe(title);
  });

  it("본문은 main landmark 안에 있고, 사이드바의 현재 메뉴 링크만 aria-current=page 다", () => {
    renderLayout("/scans");

    expect(within(screen.getByRole("main")).getByText("본문")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(within(nav).getByRole("link", { name: "스캔 이력" })).toHaveAttribute("aria-current", "page");
    for (const name of ["대시보드", "블랙리스트", "설정"]) {
      expect(within(nav).getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });
});
