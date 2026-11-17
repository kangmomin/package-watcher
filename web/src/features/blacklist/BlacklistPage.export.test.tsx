import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BLACKLIST,
  renderBlacklist,
  rowCheckbox,
  selectRows,
  setupServer,
} from "@/features/blacklist/bulkTestUtils";
import { advance, chooseOption } from "@/test/ui";
import { vi } from "vitest";

async function openExportMenu(user: Awaited<ReturnType<typeof renderBlacklist>>["user"]) {
  await user.click(screen.getByRole("button", { name: /내보내기/ }));
  return screen.findByRole("menu");
}

function linkUrl(name: string): URL {
  const link = screen.getByRole("menuitem", { name });
  return new URL(link.getAttribute("href") ?? "", "http://localhost");
}

describe("블랙리스트 — 내보내기", () => {
  it("[BK-24] 버튼 순서는 [가져오기] [내보내기] [항목 추가] 다", async () => {
    setupServer();
    await renderBlacklist();

    const names = ["가져오기", /내보내기/, "항목 추가"].map((name) =>
      screen.getByRole("button", { name }),
    );
    names.forEach((button, index) => {
      const next = names[index + 1];
      if (next)
        expect(
          button.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
  });

  it("[v2-AC-15][BK-24] [내보내기] 메뉴에는 JSON·CSV 다운로드 링크가 있고 기본 보기라서 format 과 excludeSource=cve 가 붙는다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    await openExportMenu(user);

    const json = screen.getByRole("menuitem", { name: "JSON" });
    const csv = screen.getByRole("menuitem", { name: "CSV" });
    expect(json).toHaveAttribute("download");
    expect(csv).toHaveAttribute("download");
    expect(json.tagName).toBe("A");
    expect(json.getAttribute("href")).toBe("/api/blacklist/export?format=json&excludeSource=cve");
    expect(csv.getAttribute("href")).toBe("/api/blacklist/export?format=csv&excludeSource=cve");
  });

  it("[BK-24] 지금의 필터(ecosystem, status, q)를 링크에 붙인다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = setupServer();
    const { user } = await renderBlacklist();

    await chooseOption(user, screen.getByRole("combobox", { name: "종류" }), "go");
    await chooseOption(user, screen.getByRole("combobox", { name: "상태" }), "만료");
    await user.type(screen.getByRole("textbox", { name: "이름" }), " lo ");
    await advance(400);
    await vi.waitFor(() =>
      expect(server.last("GET", BLACKLIST)?.query).toEqual({
        ecosystem: "go",
        status: "expired",
        q: "lo",
        excludeSource: "cve",
      }),
    );

    await openExportMenu(user);
    for (const [name, format] of [
      ["JSON", "json"],
      ["CSV", "csv"],
    ] as const) {
      const url = linkUrl(name);
      expect(url.pathname).toBe("/api/blacklist/export");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        format,
        ecosystem: "go",
        status: "expired",
        q: "lo",
        excludeSource: "cve",
      });
    }
  });

  it("[BK-24] 이름 입력 중(debounce 전)에는 아직 반영하지 않은 값을 링크에 쓰지 않는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupServer();
    const { user } = await renderBlacklist();

    await user.type(screen.getByRole("textbox", { name: "이름" }), "lo");
    await openExportMenu(user);
    expect(linkUrl("JSON").searchParams.has("q")).toBe(false);
  });

  it("[BK-24] 선택 상태는 내보내기에 영향을 주지 않는다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash", "evil-pkg");
    await openExportMenu(user);

    expect(screen.getByRole("menuitem", { name: "JSON" }).getAttribute("href")).toBe(
      "/api/blacklist/export?format=json&excludeSource=cve",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(rowCheckbox("lodash")).toBeChecked();
  });
});
