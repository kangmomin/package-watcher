// 묶음 F: 설정의 "브랜치 스캔 기간(일)".
import { settingsInputSchema, type ApiError } from "@pw/shared";
import { emptyFindingsPage, settingsDefault, summaryDefault } from "@pw/shared/fixtures";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { feedStatusDefault } from "@/test/feedFixtures";
import { reply, setupFetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { expectFieldError, findToast, schemaErrors } from "@/test/ui";

const SETTINGS = "/api/settings";

function setup() {
  let current = settingsDefault;
  const server = setupFetchMock()
    .on("GET", SETTINGS, (request) => reply.json(current)(request))
    .on("PUT", SETTINGS, (request) => {
      current = { ...current, ...settingsInputSchema.parse(request.body) };
      return reply.json(current)(request);
    })
    .on("GET", "/api/feed", reply.json(feedStatusDefault))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/blacklist", reply.json({ items: [] }));
  const { user } = renderWithProviders(<SettingsPage />, { route: "/settings" });
  return { server, user };
}

const daysInput = () => screen.findByLabelText(/브랜치 스캔 기간\(일\)/);
const save = () => screen.getByRole("button", { name: "저장" });

describe("설정 — 브랜치 스캔 기간", () => {
  it("[SF-70] 숫자 입력이 저장된 값(7)으로 채워지고 안내 문구와 연결된다", async () => {
    setup();
    const input = await daysInput();
    expect(input).toHaveValue(7);
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "30");
    expect(input).toHaveAccessibleDescription(
      "최근 이 기간에 커밋이 있는 브랜치도 스캔합니다(repo당 최대 20개, 기본 브랜치와 다른 파일만). 0이면 기본 브랜치만 스캔합니다.",
    );
    expect(screen.queryByText("기본 브랜치만")).not.toBeInTheDocument();
  });

  it("[SF-71] 값을 바꾸고 [저장] 하면 PUT 본문에 branchScanDays 가 숫자로 들어간다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "14");
    await user.click(save());
    await findToast("설정을 저장했습니다");
    expect((server.last("PUT", SETTINGS)?.body as Record<string, unknown>).branchScanDays).toBe(14);
  });

  it("[SF-72] 0 이면 입력 옆에 '기본 브랜치만' 을 보이고 0 으로 저장할 수 있다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "0");
    expect(await screen.findByText("기본 브랜치만")).toBeInTheDocument();
    await user.click(save());
    await findToast("설정을 저장했습니다");
    expect((server.last("PUT", SETTINGS)?.body as Record<string, unknown>).branchScanDays).toBe(0);
  });

  it("[SF-73] 범위 밖(31)은 shared 스키마의 오류를 필드에 연결해 보이고 요청하지 않는다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "31");
    await user.click(save());
    const expected = schemaErrors(settingsInputSchema, {
      org: "my-org",
      scanIntervalHours: 24,
      digestTime: "09:00",
      recipients: settingsDefault.recipients,
      branchScanDays: 31,
    });
    await expectFieldError(input, expected.branchScanDays ?? "");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  const RANGE_MESSAGE = "브랜치 스캔 기간은 0~30 사이의 정수입니다";

  it("[SF-74] 빈 값은 오류 메시지를 보이고 요청하지 않는다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    await user.click(save());
    await expectFieldError(input, RANGE_MESSAGE);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  it("[SF-76] 소수(1.5)는 오류 메시지를 보이고 요청하지 않는다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "1.5");
    await user.click(save());
    await expectFieldError(input, RANGE_MESSAGE);
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  it("[SF-77] 음수(-1)는 오류 메시지를 보이고 요청하지 않는다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "-1");
    await user.click(save());
    await expectFieldError(input, RANGE_MESSAGE);
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  it("[SF-78] 입력을 비운 채 다른 필드를 고쳐 저장해도 PUT 이 나가지 않는다", async () => {
    const { server, user } = setup();
    const input = await daysInput();
    await user.clear(input);
    const interval = screen.getByLabelText(/interval/);
    await user.clear(interval);
    await user.type(interval, "6");
    await user.click(save());
    await expectFieldError(input, RANGE_MESSAGE);
    expect(server.count("PUT", SETTINGS)).toBe(0);
  });

  it("[SF-79] 저장 뒤 입력은 서버가 돌려준 값으로 보인다", async () => {
    const { server, user } = setup();
    server.on("PUT", SETTINGS, (request) => reply.json({ ...settingsDefault, branchScanDays: 9 })(request));
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "14");
    await user.click(save());
    await findToast("설정을 저장했습니다");
    await waitFor(() => expect(input).toHaveValue(9));
  });

  it("[SF-75] 서버가 branchScanDays 를 거부하면 그 필드에 오류를 표시한다", async () => {
    const error: ApiError = {
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인하십시오",
        details: { branchScanDays: "서버가 거부한 기간입니다" },
      },
    };
    const { server, user } = setup();
    server.on("PUT", SETTINGS, reply.error(error));
    const input = await daysInput();
    await user.clear(input);
    await user.type(input, "3");
    await user.click(save());
    await expectFieldError(input, "서버가 거부한 기간입니다");
  });
});
