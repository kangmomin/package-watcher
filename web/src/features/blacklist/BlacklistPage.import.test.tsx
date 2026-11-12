import { IMPORT_MAX_BYTES } from "@pw/shared";
import {
  apiErrorOf,
  importApplied,
  importPreviewClean,
  importPreviewWithErrors,
} from "@pw/shared/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { counts, IMPORT, renderBlacklist, setupServer } from "@/features/blacklist/bulkTestUtils";
import { deferredReply, reply, type FetchMock } from "@/test/fetchMock";
import { findToast, settle } from "@/test/ui";

// jsdom 의 File 에 text() 가 없으면 FileReader 로 대신한다 (polyfills.ts 는 건드리지 않는다).
beforeAll(() => {
  if (typeof File.prototype.text !== "function") {
    Object.defineProperty(File.prototype, "text", {
      configurable: true,
      value(this: Blob) {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(this);
        });
      },
    });
  }
});

const CSV_TEXT = "ecosystem,name,reason\nnpm,left-pad,테스트\n";
const csvFile = (content = CSV_TEXT, name = "list.csv") =>
  new File([content], name, { type: "text/csv" });

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "가져오기" }));
  return screen.findByRole("dialog");
}

const fileInput = (dialog: HTMLElement) =>
  within(dialog).getByLabelText("파일 선택") as HTMLInputElement;
const applyButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "적용" });
const importCalls = (server: FetchMock) => server.requests("POST", IMPORT);

describe("블랙리스트 — 가져오기: 미리 보기", () => {
  it("[v2-AC-16][BK-23] [가져오기] 는 파일 input(.json,.csv)이 있는 Dialog 를 열고, 파일을 고르기 전에는 [적용] 이 비활성이다", async () => {
    setupServer();
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    expect(fileInput(dialog)).toHaveAttribute("accept", ".json,.csv");
    expect(applyButton(dialog)).toBeDisabled();
    expect(within(dialog).queryByRole("status")).not.toHaveTextContent("추가");
  });

  it("[v2-AC-16] CSV 를 고르면 바로 dryRun:true 로 미리 보기를 요청하고 결과 문구를 보여 준다", async () => {
    const server = setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "추가 2건, 갱신 1건, 변경 없음 3건, 오류 0건",
    );
    expect(importCalls(server)).toHaveLength(1);
    expect(server.last("POST", IMPORT)?.body).toEqual({
      format: "csv",
      content: CSV_TEXT,
      dryRun: true,
    });
    expect(applyButton(dialog)).toBeEnabled();
  });

  it("[BK-23] .json 확장자는 format 'json' 으로 보낸다", async () => {
    const server = setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    const json = '{"version":1,"items":[]}';
    await user.upload(fileInput(dialog), csvFile(json, "list.json"));

    await within(dialog).findByText(/추가 2건/);
    expect(server.last("POST", IMPORT)?.body).toEqual({
      format: "json",
      content: json,
      dryRun: true,
    });
  });

  it("[BK-23] 미리 보기 중에는 진행 표시를 보이고 [적용] 이 비활성이다", async () => {
    const pending = deferredReply();
    setupServer().on("POST", IMPORT, pending.reply);
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());

    expect(await within(dialog).findByRole("status")).toHaveTextContent("미리 보기 중");
    expect(applyButton(dialog)).toBeDisabled();
    pending.resolve(reply.json(importPreviewClean));
    await within(dialog).findByText(/추가 2건/);
    expect(applyButton(dialog)).toBeEnabled();
  });

  it("[v2-EC-10] 오류가 있으면 오류 목록(행 번호, 필드, 메시지)을 보이고 [적용] 이 비활성이다", async () => {
    setupServer().on("POST", IMPORT, reply.json(importPreviewWithErrors));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "추가 1건, 갱신 0건, 변경 없음 0건, 오류 2건",
    );
    const items = within(within(dialog).getByRole("list", { name: "오류 목록" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("2행");
    expect(items[0]).toHaveTextContent("versionRange");
    expect(items[0]).toHaveTextContent("유효한 semver 범위가 아닙니다");
    // field 가 null 이면 '-'
    expect(items[1]).toHaveTextContent(/^4행\s*-\s*파일 안에서 중복된 항목입니다/);
    expect(applyButton(dialog)).toBeDisabled();
  });

  it("[BK-23] 오류가 없으면 오류 목록을 만들지 않는다", async () => {
    setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);
    expect(within(dialog).queryByRole("list", { name: "오류 목록" })).not.toBeInTheDocument();
  });

  it("[BK-23] 추가 + 갱신이 0건이면 [적용] 이 비활성이다", async () => {
    setupServer().on(
      "POST",
      IMPORT,
      reply.json({ ...importPreviewClean, created: 0, updated: 0, unchanged: 4 }),
    );
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/변경 없음 4건/);
    expect(applyButton(dialog)).toBeDisabled();
  });
});

describe("블랙리스트 — 가져오기: 파일 검사", () => {
  it("[BK-23] .json·.csv 가 아니면 요청하지 않고 'JSON 또는 CSV 파일을 선택하십시오' 를 보인다", async () => {
    const server = setupServer();
    await renderBlacklist();
    // accept 필터를 끄고 직접 확장자 검사를 확인한다.
    const user = userEvent.setup({ applyAccept: false });
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), new File(["x"], "list.txt", { type: "text/plain" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "JSON 또는 CSV 파일을 선택하십시오",
    );
    expect(importCalls(server)).toHaveLength(0);
    expect(applyButton(dialog)).toBeDisabled();
  });

  it("[BK-23] 1 MB 를 넘으면 요청하지 않고 '파일이 너무 큽니다 (최대 1 MB)' 를 보인다", async () => {
    const server = setupServer();
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    const big = new File(["x"], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: IMPORT_MAX_BYTES + 1 });
    await user.upload(fileInput(dialog), big);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "파일이 너무 큽니다 (최대 1 MB)",
    );
    expect(importCalls(server)).toHaveLength(0);
    expect(applyButton(dialog)).toBeDisabled();
  });

  it("[BK-23] 정확히 한도 크기의 파일은 보낸다", async () => {
    const server = setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    const edge = new File(["x"], "edge.csv", { type: "text/csv" });
    Object.defineProperty(edge, "size", { value: IMPORT_MAX_BYTES });
    await user.upload(fileInput(dialog), edge);

    await within(dialog).findByText(/추가 2건/);
    expect(importCalls(server)).toHaveLength(1);
  });

  it("[BK-23] 다른 파일을 다시 고르면 이전 결과를 지우고 새로 미리 본다", async () => {
    const server = setupServer()
      .once("POST", IMPORT, reply.json(importPreviewWithErrors))
      .on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile("a", "a.csv"));
    await within(dialog).findByRole("list", { name: "오류 목록" });

    await user.upload(fileInput(dialog), csvFile("b", "b.csv"));
    await waitFor(() =>
      expect(within(dialog).queryByRole("list", { name: "오류 목록" })).not.toBeInTheDocument(),
    );
    await within(dialog).findByText(/추가 2건, 갱신 1건/);
    expect(importCalls(server).map((call) => (call.body as { content: string }).content)).toEqual([
      "a",
      "b",
    ]);
  });

  it("[BK-23] 잘못된 파일을 다시 고르면 이전 오류를 지운다", async () => {
    setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    await renderBlacklist();
    const user = userEvent.setup({ applyAccept: false });
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), new File(["x"], "list.txt"));
    await within(dialog).findByRole("alert");
    await user.upload(fileInput(dialog), csvFile());

    await within(dialog).findByText(/추가 2건/);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[BK-23] Dialog 를 닫았다 열면 초기 상태다", async () => {
    setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist();
    let dialog = await openImport(user);
    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);

    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openImport(user);
    expect(within(dialog).queryByText(/추가 2건/)).not.toBeInTheDocument();
    expect(applyButton(dialog)).toBeDisabled();
  });
});

describe("블랙리스트 — 가져오기: 적용", () => {
  it("[v2-AC-17] [적용] 은 같은 format·content 를 dryRun:false 로 보내고 toast + 무효화 3개 + Dialog 닫기를 한다", async () => {
    const server = setupServer()
      .once("POST", IMPORT, reply.json(importPreviewClean))
      .once("POST", IMPORT, reply.json(importApplied));
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);
    await user.click(applyButton(dialog));

    await findToast("가져오기를 적용했습니다 (추가 2건, 갱신 1건)");
    expect(importCalls(server).map((call) => call.body)).toEqual([
      { format: "csv", content: CSV_TEXT, dryRun: true },
      { format: "csv", content: CSV_TEXT, dryRun: false },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => {
      const after = counts(server);
      expect(after.blacklist).toBe(before.blacklist + 1);
      expect(after.findings).toBe(before.findings + 1);
      expect(after.summary).toBe(before.summary + 1);
    });
  });

  it("[BK-23] 미리 보기만 한 동안에는 목록을 다시 읽지 않는다", async () => {
    const server = setupServer().on("POST", IMPORT, reply.json(importPreviewClean));
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);
    await settle();
    expect(counts(server)).toEqual(before);
  });

  it("[BK-23] 적용 중에는 [적용] 이 비활성이다", async () => {
    const pending = deferredReply();
    setupServer()
      .once("POST", IMPORT, reply.json(importPreviewClean))
      .on("POST", IMPORT, pending.reply);
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);
    await user.click(applyButton(dialog));

    await waitFor(() => expect(applyButton(dialog)).toBeDisabled());
    pending.resolve(reply.json(importApplied));
    await findToast("가져오기를 적용했습니다");
  });

  it("[BK-23] applied:false 이면 새 결과를 표시하고 Dialog 를 유지하며 toast·무효화를 하지 않는다", async () => {
    const server = setupServer()
      .once("POST", IMPORT, reply.json(importPreviewClean))
      .once("POST", IMPORT, reply.json({ ...importPreviewWithErrors }));
    const { user } = await renderBlacklist({ withDashboard: true });
    await settle();
    const before = counts(server);
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);
    await user.click(applyButton(dialog));

    expect(await within(dialog).findByText(/오류 2건/)).toBeInTheDocument();
    expect(within(dialog).getByRole("list", { name: "오류 목록" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(applyButton(dialog)).toBeDisabled();
    await settle();
    expect(screen.queryByText("가져오기를 적용했습니다")).not.toBeInTheDocument();
    expect(counts(server)).toEqual(before);
  });
});

describe("블랙리스트 — 가져오기: 오류 응답", () => {
  const validation = apiErrorOf("VALIDATION_ERROR", "머리글에 name 열이 없습니다");

  it("[v2-EC-11] 400 VALIDATION_ERROR 는 Dialog 안에 서버 메시지(role=alert)를 보이고 Dialog 를 유지하며 [적용] 이 비활성이다", async () => {
    setupServer().on("POST", IMPORT, reply.error(validation));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "머리글에 name 열이 없습니다",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(applyButton(dialog)).toBeDisabled();
  });

  it("[v2-EC-11] 적용 중의 400 도 Dialog 안에 메시지를 보이고 [적용] 이 비활성이다", async () => {
    setupServer()
      .once("POST", IMPORT, reply.json(importPreviewClean))
      .on("POST", IMPORT, reply.error(validation));
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());
    await within(dialog).findByText(/추가 2건/);
    await user.click(applyButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "머리글에 name 열이 없습니다",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(applyButton(dialog)).toBeDisabled();
  });

  it("[BK-23] 네트워크 오류는 toast 를 보이고 Dialog 를 유지한다", async () => {
    setupServer().on("POST", IMPORT, reply.networkError());
    const { user } = await renderBlacklist();
    const dialog = await openImport(user);

    await user.upload(fileInput(dialog), csvFile());

    await findToast("서버에 연결할 수 없습니다");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(applyButton(dialog)).toBeDisabled();
  });
});
