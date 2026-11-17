// 설정 화면의 취약점 기준 점수와 외부 목록 상태의 분류별 표시.
import { settingsInputSchema, type FeedStatus } from "@pw/shared";
import { emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { feedStatusDefault } from "@/test/feedFixtures";
import { renderWithProviders } from "@/test/render";
import { expectFieldError, findToast } from "@/test/ui";

const SETTINGS = "/api/settings";

function setupServer(status: FeedStatus = feedStatusDefault, settings = settingsDefault): FetchMock {
  let current = settings;
  return setupFetchMock()
    .on("GET", SETTINGS, (request) => reply.json(current)(request))
    .on("PUT", SETTINGS, (request) => {
      current = { ...current, ...settingsInputSchema.parse(request.body) };
      return reply.json(current)(request);
    })
    .on("GET", "/api/feed", reply.json(status))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/blacklist", reply.json({ items: [] }));
}

async function renderSettings() {
  const result = renderWithProviders(<SettingsPage />, { route: "/settings" });
  await screen.findByRole("button", { name: "저장" });
  return result;
}

const scoreInput = () => screen.getByRole("spinbutton", { name: "취약점의 기준 점수" });

async function setScore(user: Awaited<ReturnType<typeof renderSettings>>["user"], value: string) {
  await user.clear(scoreInput());
  if (value !== "") await user.type(scoreInput(), value);
}

describe("설정 — 취약점의 기준 점수", () => {
  it("[SI-71] 외부 목록 구역에 현재 값과 안내 문장을 보인다", async () => {
    setupServer();
    await renderSettings();
    const region = screen.getByRole("region", { name: "외부 목록" });
    expect(within(region).getByRole("spinbutton", { name: "취약점의 기준 점수" })).toHaveValue(8);
    expect(
      within(region).getByText(
        "CVSS 점수가 이 값 이상인 취약점을 대조합니다. 0 = 끔. 취약점은 즉시 메일을 보내지 않고 요약 메일에 건수만 들어갑니다.",
      ),
    ).toBeInTheDocument();
    expect(scoreInput()).toHaveAccessibleDescription(/CVSS 점수가 이 값 이상인/);
  });

  it("[SI-72] 값을 바꿔 [저장] 하면 PUT 본문에 cveMinScore 가 들어가고, 저장 전에는 요청하지 않는다", async () => {
    const server = setupServer();
    const { user } = await renderSettings();
    await setScore(user, "6.5");
    expect(server.count("PUT", SETTINGS)).toBe(0);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await findToast("설정을 저장했습니다");
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).cveMinScore).toBe(6.5);
    await waitFor(() => expect(scoreInput()).toHaveValue(6.5));
  });

  it("[SI-73] 0(끔) 도 저장할 수 있다", async () => {
    const server = setupServer();
    const { user } = await renderSettings();
    await setScore(user, "0");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await findToast("설정을 저장했습니다");
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).cveMinScore).toBe(0);
  });

  it.each([["3.9"], ["10.1"], ["5.55"], [""]])(
    "[SI-74] 범위 밖이거나 소수 1자리가 아닌 값(%j)은 저장하지 않고 필드 오류를 보인다",
    async (value) => {
      const server = setupServer();
      const { user } = await renderSettings();
      await setScore(user, value);
      await user.click(screen.getByRole("button", { name: "저장" }));
      await expectFieldError(scoreInput(), "취약점의 기준 점수는 0(끔) 또는 4~10 사이의 값입니다");
      expect(scoreInput()).toHaveAttribute("aria-invalid", "true");
      expect(server.count("PUT", SETTINGS)).toBe(0);
    },
  );

  it("[SI-75] 외부 목록 사용이 꺼져 있으면 입력이 비활성이고, 켜면 다시 활성이다", async () => {
    const server = setupServer(feedStatusDefault, { ...settingsDefault, feedEnabled: false });
    const { user } = await renderSettings();
    expect(scoreInput()).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: "외부 목록 사용" }));
    expect(scoreInput()).toBeEnabled();
    await user.click(screen.getByRole("switch", { name: "외부 목록 사용" }));
    expect(scoreInput()).toBeDisabled();
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  it("[SI-76] 입력이 비활성이어도 저장하면 기존 값(cveMinScore)을 그대로 보낸다", async () => {
    const server = setupServer(feedStatusDefault, { ...settingsDefault, feedEnabled: false, cveMinScore: 7.5 });
    const { user } = await renderSettings();
    await user.click(screen.getByRole("switch", { name: "외부 목록 사용" }));
    await user.click(screen.getByRole("switch", { name: "외부 목록 사용" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await findToast("설정을 저장했습니다");
    expect(settingsInputSchema.parse(server.last("PUT", SETTINGS)?.body).cveMinScore).toBe(7.5);
  });
});

describe("설정 — 외부 목록 상태의 분류별 표시", () => {
  const status = (cveDone: boolean): FeedStatus => ({
    ...feedStatusDefault,
    fullSyncDone: cveDone,
    entryCount: 151751 + 26000,
    byKind: {
      malware: { ...feedStatusDefault.byKind.malware, entryCount: 151751 },
      cve: { ...feedStatusDefault.byKind.cve, entryCount: 26000, fullSyncDone: cveDone },
    },
  });

  it("[SI-77] 분류별 건수(악성 패키지·취약점)를 천 단위 구분으로 보인다", async () => {
    setupServer(status(true));
    await renderSettings();
    const region = screen.getByRole("region", { name: "외부 목록" });
    expect(await within(region).findByText("악성 패키지 151,751건 · 취약점 26,000건")).toBeInTheDocument();
    expect(within(region).queryByText(/첫 동기화가 끝나지/)).not.toBeInTheDocument();
  });

  it("[SI-78] 취약점의 첫 동기화가 끝나지 않았으면 그 안내를 한 번만 보인다", async () => {
    setupServer(status(false));
    await renderSettings();
    const region = screen.getByRole("region", { name: "외부 목록" });
    expect(await within(region).findByText("취약점의 첫 동기화가 끝나지 않았습니다 — 목록이 일부입니다")).toBeInTheDocument();
    expect(within(region).queryByText("첫 동기화가 끝나지 않았습니다 — 목록이 일부입니다")).not.toBeInTheDocument();
  });
});
