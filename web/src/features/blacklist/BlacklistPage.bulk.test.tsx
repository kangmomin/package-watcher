import {
  apiErrorNotFound,
  apiErrorOf,
  blacklistEntryVariants,
  bulkResultDisable,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ALL_ITEMS,
  BLACKLIST,
  BULK,
  bulkBar,
  bulkButton,
  counts,
  renderBlacklist,
  rowCheckbox,
  selectAllCheckbox,
  selectRows,
  setupServer,
} from "@/features/blacklist/bulkTestUtils";
import { deferredReply, reply } from "@/test/fetchMock";
import { chooseOption, findToast, settle } from "@/test/ui";

const bulkOk = (action: "enable" | "disable" | "delete", count: number) =>
  reply.json({ action, count });
const SELECTION_TEXT = /^선택 \d+건:$/;

describe("블랙리스트 — 선택", () => {
  it("[BK-21] 행마다 '{이름} 선택' 체크박스가 있고, 선택하기 전에는 일괄 버튼이 없다", async () => {
    setupServer();
    await renderBlacklist();

    expect(rowCheckbox("lodash")).not.toBeChecked();
    expect(rowCheckbox("paused-pkg")).not.toBeChecked();
    for (const name of ["켜기", "끄기", "삭제"]) {
      expect(within(bulkBar()).queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("[BK-21][v2-AC-18] 1건 이상 선택하면 '선택 n건:' 과 [켜기] [끄기] [삭제] 가 나타난다(건수는 aria-live)", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash", "evil-pkg");
    expect(screen.getByText("선택 2건:")).toHaveAttribute("aria-live", "polite");
    expect(bulkButton("켜기")).toBeEnabled();
    expect(bulkButton("끄기")).toBeEnabled();
    expect(bulkButton("삭제")).toBeEnabled();

    await user.click(rowCheckbox("lodash"));
    expect(screen.getByText("선택 1건:")).toBeInTheDocument();
    await user.click(rowCheckbox("evil-pkg"));
    expect(screen.queryByText(SELECTION_TEXT)).not.toBeInTheDocument();
    expect(within(bulkBar()).queryByRole("button", { name: "켜기" })).not.toBeInTheDocument();
  });

  it("[BK-21] 머리글의 '모두 선택'은 보이는 행 전체를 선택·해제하고, 일부만 선택이면 indeterminate 다", async () => {
    setupServer();
    const { user } = await renderBlacklist();

    expect(selectAllCheckbox()).not.toBeChecked();
    await user.click(rowCheckbox("lodash"));
    expect(selectAllCheckbox()).toBePartiallyChecked();

    await user.click(selectAllCheckbox());
    expect(screen.getByText(`선택 ${ALL_ITEMS.length}건:`)).toBeInTheDocument();
    expect(selectAllCheckbox()).toBeChecked();
    expect(rowCheckbox("stale-pkg")).toBeChecked();

    await user.click(selectAllCheckbox());
    expect(screen.queryByText(SELECTION_TEXT)).not.toBeInTheDocument();
    expect(rowCheckbox("lodash")).not.toBeChecked();
  });

  it("[BK-21] 필터를 바꿔 보이지 않게 된 항목은 선택에서 빠지고, 필터를 되돌려도 다시 선택되지 않는다", async () => {
    setupServer().on("GET", BLACKLIST, (request) =>
      reply.json({
        items: request.query.status === "disabled" ? [blacklistEntryVariants[0]] : ALL_ITEMS,
      })(request),
    );
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash", "paused-pkg");
    expect(screen.getByText("선택 2건:")).toBeInTheDocument();

    await chooseOption(user, screen.getByRole("combobox", { name: "상태" }), "끔");
    await waitFor(() => expect(screen.getByText("선택 1건:")).toBeInTheDocument());
    expect(rowCheckbox("paused-pkg")).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "lodash 선택" })).not.toBeInTheDocument();

    await chooseOption(user, screen.getByRole("combobox", { name: "상태" }), "전체");
    await waitFor(() => expect(rowCheckbox("lodash")).toBeInTheDocument());
    expect(rowCheckbox("lodash")).not.toBeChecked();
    expect(screen.getByText("선택 1건:")).toBeInTheDocument();
  });
});

describe("블랙리스트 — 일괄 켜기·끄기", () => {
  it("[v2-AC-18][BK-22] [끄기] 는 선택한 id 로 POST /bulk 를 보내고 'n건을 껐습니다'(응답 count) toast + 선택 해제 + 무효화 3개", async () => {
    const server = setupServer().on("POST", BULK, reply.json(bulkResultDisable));
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);

    await selectRows(user, "lodash", "evil-pkg");
    await user.click(bulkButton("끄기"));

    await findToast("2건을 껐습니다");
    expect(server.last("POST", BULK)?.body).toEqual({ action: "disable", ids: [2, 1] });
    await waitFor(() => {
      const after = counts(server);
      expect(after.blacklist).toBe(before.blacklist + 1);
      expect(after.findings).toBe(before.findings + 1);
      expect(after.summary).toBe(before.summary + 1);
    });
    expect(screen.queryByText(SELECTION_TEXT)).not.toBeInTheDocument();
    expect(rowCheckbox("lodash")).not.toBeChecked();
  });

  it("[BK-22] [켜기] 는 action 'enable' 로 보내고 toast 는 응답의 count 를 쓴다", async () => {
    const server = setupServer().on("POST", BULK, bulkOk("enable", 5));
    const { user } = await renderBlacklist();

    await selectRows(user, "paused-pkg");
    await user.click(bulkButton("켜기"));

    await findToast("5건을 켰습니다");
    expect(server.last("POST", BULK)?.body).toEqual({ action: "enable", ids: [11] });
  });

  it("[BK-22] 요청 중에는 세 버튼이 비활성이고 끝나면 풀린다", async () => {
    const pending = deferredReply();
    setupServer().on("POST", BULK, pending.reply);
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash", "evil-pkg");
    await user.click(bulkButton("끄기"));
    await waitFor(() => expect(bulkButton("끄기")).toBeDisabled());
    expect(bulkButton("켜기")).toBeDisabled();
    expect(bulkButton("삭제")).toBeDisabled();

    pending.resolve(bulkOk("disable", 2));
    await findToast("2건을 껐습니다");
  });

  it("[v2-EC-13] 404 NOT_FOUND 는 서버 메시지 toast + blacklist 재조회 + 선택 해제다(findings·summary 는 다시 읽지 않는다)", async () => {
    const server = setupServer().on("POST", BULK, reply.error(apiErrorNotFound));
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);

    await selectRows(user, "lodash", "evil-pkg");
    await user.click(bulkButton("끄기"));

    await findToast(apiErrorNotFound.error.message);
    await waitFor(() => expect(counts(server).blacklist).toBe(before.blacklist + 1));
    await settle();
    expect(counts(server).findings).toBe(before.findings);
    expect(counts(server).summary).toBe(before.summary);
    expect(screen.queryByText(SELECTION_TEXT)).not.toBeInTheDocument();
  });

  it("[BK-22] 결과를 알 수 없는 오류(NETWORK_ERROR)는 toast 와 3개 무효화를 하고 선택은 그대로 둔다", async () => {
    const server = setupServer().on("POST", BULK, reply.networkError());
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);

    await selectRows(user, "lodash");
    await user.click(bulkButton("끄기"));

    await findToast("서버에 연결할 수 없습니다");
    await waitFor(() => {
      const after = counts(server);
      expect(after.blacklist).toBe(before.blacklist + 1);
      expect(after.findings).toBe(before.findings + 1);
      expect(after.summary).toBe(before.summary + 1);
    });
    expect(screen.getByText("선택 1건:")).toBeInTheDocument();
  });

  it("[BK-22] 그 밖의 서버 오류는 서버 메시지를 toast 로 보여 준다", async () => {
    setupServer().on(
      "POST",
      BULK,
      reply.error(apiErrorOf("VALIDATION_ERROR", "ids 는 1~1000개입니다")),
    );
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash");
    await user.click(bulkButton("끄기"));
    await findToast("ids 는 1~1000개입니다");
  });
});

describe("블랙리스트 — 일괄 삭제", () => {
  it("[v2-AC-18][BK-22] [삭제] 는 확인 Dialog 를 먼저 띄우고, [취소] 하면 요청하지 않는다", async () => {
    const server = setupServer().on("POST", BULK, bulkOk("delete", 2));
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash", "evil-pkg");
    await user.click(bulkButton("삭제"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "선택한 2건을 삭제합니다. 이 항목들의 검출은 resolved로 바뀝니다",
    );
    expect(server.count("POST", BULK)).toBe(0);

    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(server.count("POST", BULK)).toBe(0);
    expect(screen.getByText("선택 2건:")).toBeInTheDocument();
  });

  it("[BK-22] 확인하면 action 'delete' 로 보내고 'n건을 삭제했습니다' toast + 선택 해제 + 무효화 3개 + Dialog 닫기", async () => {
    const server = setupServer().on("POST", BULK, bulkOk("delete", 2));
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);

    await selectRows(user, "lodash", "evil-pkg");
    await user.click(bulkButton("삭제"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));

    await findToast("2건을 삭제했습니다");
    expect(server.last("POST", BULK)?.body).toEqual({ action: "delete", ids: [2, 1] });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => {
      const after = counts(server);
      expect(after.blacklist).toBe(before.blacklist + 1);
      expect(after.findings).toBe(before.findings + 1);
      expect(after.summary).toBe(before.summary + 1);
    });
    expect(screen.queryByText(SELECTION_TEXT)).not.toBeInTheDocument();
  });

  it("[v2-EC-13][BK-22] 삭제 중 404 이면 서버 메시지 toast + Dialog 닫기 + 선택 해제", async () => {
    setupServer().on("POST", BULK, reply.error(apiErrorNotFound));
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash");
    await user.click(bulkButton("삭제"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));

    await findToast(apiErrorNotFound.error.message);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText(SELECTION_TEXT)).not.toBeInTheDocument();
  });

  it("[BK-22] 삭제 요청 중에는 Dialog 의 [삭제] 가 비활성이다", async () => {
    const pending = deferredReply();
    setupServer().on("POST", BULK, pending.reply);
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash");
    await user.click(bulkButton("삭제"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "삭제" })).toBeDisabled(),
    );
    pending.resolve(bulkOk("delete", 1));
    await findToast("1건을 삭제했습니다");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});

describe("블랙리스트 — 일괄 작업 보완 (코드 리뷰)", () => {
  it("[BK-25] 삭제 확인 Dialog 를 연 뒤 목록이 바뀌어 선택이 바뀌면 Dialog 를 닫고 요청하지 않는다", async () => {
    let items = ALL_ITEMS;
    const server = setupServer().on("GET", BLACKLIST, (request) => reply.json({ items })(request));
    server.on("POST", BULK, bulkOk("delete", 2));
    const { user, queryClient } = await renderBlacklist();

    await selectRows(user, "lodash", "evil-pkg");
    await user.click(bulkButton("삭제"));
    await screen.findByRole("alertdialog");

    items = ALL_ITEMS.filter((item) => item.name !== "lodash");
    await queryClient.invalidateQueries({ queryKey: ["blacklist"] });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(server.count("POST", BULK)).toBe(0);
    expect(screen.getByText("선택 1건:")).toBeInTheDocument();
  });

  it("[BK-25] 필터 변경 직후 이전 목록이 보이는 동안에는 일괄 버튼과 체크박스가 비활성이고 표가 aria-busy 다", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    setupServer().on("GET", BLACKLIST, async (request) => {
      if (request.query.status) await released;
      return reply.json({ items: ALL_ITEMS })(request);
    });
    const { user } = await renderBlacklist();
    await selectRows(user, "lodash");

    await chooseOption(user, screen.getByRole("combobox", { name: "상태" }), "끔");
    await waitFor(() => expect(bulkButton("끄기")).toBeDisabled());
    expect(bulkButton("켜기")).toBeDisabled();
    expect(bulkButton("삭제")).toBeDisabled();
    expect(rowCheckbox("lodash")).toBeDisabled();
    expect(selectAllCheckbox()).toBeDisabled();
    expect(screen.getByRole("table", { name: "블랙리스트" })).toHaveAttribute("aria-busy", "true");

    release();
    await waitFor(() => expect(bulkButton("끄기")).toBeEnabled());
    expect(rowCheckbox("lodash")).toBeEnabled();
    expect(screen.getByRole("table", { name: "블랙리스트" })).not.toHaveAttribute("aria-busy", "true");
  });

  it("[BK-25] 일괄 요청 중에는 체크박스가 비활성이다", async () => {
    const pending = deferredReply();
    setupServer().on("POST", BULK, pending.reply);
    const { user } = await renderBlacklist();

    await selectRows(user, "lodash");
    await user.click(bulkButton("끄기"));
    await waitFor(() => expect(rowCheckbox("lodash")).toBeDisabled());
    expect(rowCheckbox("evil-pkg")).toBeDisabled();
    expect(selectAllCheckbox()).toBeDisabled();

    pending.resolve(bulkOk("disable", 1));
    await findToast("1건을 껐습니다");
    await waitFor(() => expect(rowCheckbox("lodash")).toBeEnabled());
  });

  it("[BK-25] 선택이 1000건을 넘으면 일괄 버튼 3개가 비활성이고 안내를 보인다", async () => {
    const many = Array.from({ length: 1001 }, (_, index) => ({
      ...ALL_ITEMS[0]!,
      id: 100 + index,
      name: index === 0 ? "lodash" : `pkg-${index}`,
    }));
    setupServer(many);
    const { user } = await renderBlacklist();

    await user.click(selectAllCheckbox());
    expect(screen.getByText("선택 1001건:")).toBeInTheDocument();
    expect(bulkButton("켜기")).toBeDisabled();
    expect(bulkButton("끄기")).toBeDisabled();
    expect(bulkButton("삭제")).toBeDisabled();
    expect(within(bulkBar()).getByText("한 번에 1000건까지 처리할 수 있습니다")).toBeInTheDocument();

    await user.click(selectAllCheckbox());
    await user.click(rowCheckbox("lodash"));
    expect(bulkButton("끄기")).toBeEnabled();
    expect(screen.queryByText("한 번에 1000건까지 처리할 수 있습니다")).not.toBeInTheDocument();
    // 1001행을 그리므로 느린 환경에서도 시간 초과가 나지 않게 한다.
  }, 30_000);
});
