// v2(묶음 1/3) 블랙리스트 Dialog: 불완전한 날짜 입력 차단.
// jsdom 은 `validity.badInput` 을 구현하지 않으므로 판정 함수(lib/form 의 isIncompleteDate)를 mock 으로 제어한다.
// 판정 자체는 lib/form.v2.test.ts 가 검증한다.
import {
  blacklistEntries,
  blacklistEntryAllVersions,
  emptyFindingsPage,
  settingsDefault,
  summaryDefault,
} from "@pw/shared/fixtures";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlacklistPage } from "@/features/blacklist/BlacklistPage";
import { isIncompleteDate } from "@/lib/form";
import { reply, setupFetchMock, type FetchMock } from "@/test/fetchMock";
import { renderWithProviders } from "@/test/render";
import { expectFieldError, findRowWith, findToast, settle } from "@/test/ui";

vi.mock("@/lib/form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/form")>();
  return { ...actual, isIncompleteDate: vi.fn(actual.isIncompleteDate) };
});

const INCOMPLETE_DATE_MESSAGE = "날짜를 끝까지 입력하거나 모두 지우십시오";
const BLACKLIST = "/api/blacklist";

function setupServer(): FetchMock {
  return setupFetchMock()
    .on("GET", BLACKLIST, reply.json({ items: blacklistEntries }))
    .on("GET", "/api/findings", reply.json(emptyFindingsPage))
    .on("GET", "/api/summary", reply.json(summaryDefault))
    .on("GET", "/api/settings", reply.json(settingsDefault))
    .on("POST", BLACKLIST, reply.json({ ...blacklistEntryAllVersions, id: 3, name: "left-pad" }, 201));
}

async function openFilledAddDialog() {
  const { user } = renderWithProviders(<BlacklistPage />, { route: "/blacklist" });
  await findRowWith("lodash");
  await user.click(screen.getByRole("button", { name: "항목 추가" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: /^이름/ }), "left-pad");
  await user.type(within(dialog).getByRole("textbox", { name: /^사유/ }), "테스트 사유");
  return { user, dialog, save: within(dialog).getByRole("button", { name: "저장" }) };
}

describe("블랙리스트 v2 — 불완전한 날짜 입력", () => {
  beforeEach(() => {
    vi.mocked(isIncompleteDate).mockReset();
  });

  it("[CT-16] 만료일 입력이 불완전하면(isIncompleteDate = true) 제출하지 않고 만료일 아래에 안내를 표시한다", async () => {
    vi.mocked(isIncompleteDate).mockReturnValue(true);
    const server = setupServer();
    const { user, dialog, save } = await openFilledAddDialog();

    await user.click(save);
    await settle();

    // 불완전한 입력의 값은 "" 라서 그대로 보내면 만료가 조용히 해제된다 → 요청하지 않는다
    expect(server.count("POST", BLACKLIST)).toBe(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const expiresAt = within(dialog).getByLabelText(/^만료일/);
    await expectFieldError(expiresAt, INCOMPLETE_DATE_MESSAGE);
    // 판정 대상은 만료일 입력이다
    expect(vi.mocked(isIncompleteDate)).toHaveBeenCalledWith(expiresAt);
  });

  it("[CT-16] 만료일 입력이 완성됐거나 비어 있으면(isIncompleteDate = false) 제출한다", async () => {
    vi.mocked(isIncompleteDate).mockReturnValue(false);
    const server = setupServer();
    const { user, dialog, save } = await openFilledAddDialog();

    await user.click(save);

    await findToast("항목을 추가했습니다");
    expect(server.count("POST", BLACKLIST)).toBe(1);
    expect(within(dialog).queryByText(INCOMPLETE_DATE_MESSAGE)).not.toBeInTheDocument();
    // 제출할 때 만료일 입력을 판정했다
    expect(vi.mocked(isIncompleteDate)).toHaveBeenCalled();
  });
});
