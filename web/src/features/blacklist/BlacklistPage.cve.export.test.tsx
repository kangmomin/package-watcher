// 블랙리스트 내보내기는 화면에 보이는 목록과 같은 출처 조건을 따른다.
import type { BlacklistEntry } from "@pw/shared";
import { blacklistEntryRanged, emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { chooseOption, findRowWith } from "@/test/ui";

const manualEntry: BlacklistEntry = { ...blacklistEntryRanged, id: 72, source: "manual", name: "manual-pkg" };
const cveEntry: BlacklistEntry = { ...manualEntry, id: 71, source: "cve", name: "lodash-cve-pkg" };

async function exportParams(user: ReturnType<typeof renderWithProviders>["user"], name: "JSON" | "CSV") {
  await user.click(screen.getByRole("button", { name: /내보내기/ }));
  const href = screen.getByRole("menuitem", { name }).getAttribute("href") ?? "";
  await user.keyboard("{Escape}");
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("블랙리스트 — 내보내기와 출처", () => {
  it("[SI-99] 기본은 excludeSource=cve, '취약점' 은 source=cve, '전체' 는 출처 조건 없음으로 내보낸다", async () => {
    setupFetchMock()
      .on("GET", "/api/blacklist", (request) => {
        const { source, excludeSource } = request.query;
        const items = [cveEntry, manualEntry].filter((entry) =>
          source ? entry.source === source : excludeSource ? entry.source !== excludeSource : true,
        );
        return reply.json({ items })(request);
      })
      .on("GET", "/api/findings", reply.json(emptyFindingsPage))
      .on("GET", "/api/summary", reply.json(summaryDefault))
      .on("GET", "/api/settings", reply.json(settingsDefault));
    const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
    await findRowWith("manual-pkg");
    const source = () => screen.getByRole("combobox", { name: "출처" });

    expect(await exportParams(user, "JSON")).toEqual({ format: "json", excludeSource: "cve" });

    await chooseOption(user, source(), "취약점");
    await findRowWith("lodash-cve-pkg");
    expect(await exportParams(user, "CSV")).toEqual({ format: "csv", source: "cve" });

    await chooseOption(user, source(), "전체");
    await findRowWith("manual-pkg");
    expect(await exportParams(user, "JSON")).toEqual({ format: "json" });
  });
});
