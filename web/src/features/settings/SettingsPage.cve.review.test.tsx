// 설정 화면의 리뷰 보강: 끄면 점수 오류가 저장을 막지 않는다, 즉시 알림 경고는 취약점 항목을 세지 않는다.
import { settingsInputSchema, type BlacklistEntry } from "@pw/shared";
import { blacklistEntryRanged, emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { feedStatusDefault } from "@/test/feedFixtures";
import { renderWithProviders } from "@/test/render";
import { expectFieldError, findToast } from "@/test/ui";

const SETTINGS = "/api/settings";
const BLACKLIST = "/api/blacklist";

function setupServer(settings = settingsDefault, items: BlacklistEntry[] = []): FetchMock {
  let current = settings;
  return setupFetchMock()
    .on("GET", SETTINGS, (request) => reply.json(current)(request))
    .on("PUT", SETTINGS, (request) => {
      current = { ...current, ...settingsInputSchema.parse(request.body) };
      return reply.json(current)(request);
    })
    .on("GET", "/api/feed", reply.json(feedStatusDefault))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", BLACKLIST, reply.json({ items }));
}

async function renderSettings() {
  const result = renderWithProviders(<SettingsPage />, { route: "/settings" });
  await screen.findByRole("button", { name: "저장" });
  return result;
}

const scoreInput = () => screen.getByRole("spinbutton", { name: "취약점의 기준 점수" });
const lowEntry: BlacklistEntry = {
  ...blacklistEntryRanged,
  id: 81,
  source: "manual",
  severity: "low",
  enabled: true,
  isExpired: false,
};

describe("설정 — 리뷰 보강", () => {
  it("[SI-96] 점수가 잘못된 채 외부 목록을 끄면 저장된 값으로 되돌리고 오류를 지워 저장을 막지 않는다", async () => {
    const server = setupServer();
    const { user } = await renderSettings();
    await user.clear(scoreInput());
    await user.type(scoreInput(), "3.9");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await expectFieldError(scoreInput(), "취약점의 기준 점수는");
    await user.click(screen.getByRole("switch", { name: "외부 목록 사용" }));
    expect(scoreInput()).toHaveValue(8);
    expect(scoreInput()).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await findToast("설정을 저장했습니다");
    const body = settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body);
    expect(body.feedEnabled).toBe(false);
    expect(body.cveMinScore).toBe(8);
  });

  it("[SI-97] 즉시 알림 경고는 취약점 항목(source=cve)을 세지 않는다", async () => {
    const cve: BlacklistEntry = { ...lowEntry, id: 82, source: "cve", name: "cve-pkg" };
    setupServer({ ...settingsDefault, notifyMinSeverity: "high" }, [lowEntry, cve]);
    await renderSettings();
    expect(await screen.findByText("켜진 항목 1개는 이 기준보다 낮아 즉시 알림을 받지 않습니다")).toBeInTheDocument();
  });

  it("[SI-98] 취약점 항목만 기준보다 낮으면 경고를 보이지 않는다", async () => {
    const server = setupServer({ ...settingsDefault, notifyMinSeverity: "high" }, [{ ...lowEntry, source: "cve" }]);
    await renderSettings();
    await waitFor(() => expect(server.count("GET", BLACKLIST)).toBeGreaterThan(0));
    expect(screen.queryByText(/이 기준보다 낮아 즉시 알림/)).not.toBeInTheDocument();
  });
});
