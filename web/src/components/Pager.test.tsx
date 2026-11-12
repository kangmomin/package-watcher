import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pager } from "@/components/Pager";

// 계약 문구: 페이저 `[이전] N–M / total [다음]` (N–M 사이는 en dash)
const PREV = "이전";
const NEXT = "다음";

describe("Pager", () => {
  it("[CT-02] 첫 페이지: N–M / total 을 표시하고 [이전] 은 비활성, [다음] 은 다음 page 로 바꾼다", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pager page={1} limit={50} total={120} onPageChange={onPageChange} />);

    expect(screen.getByText("1–50 / 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PREV })).toBeDisabled();
    expect(screen.getByRole("button", { name: NEXT })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: NEXT }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("[CT-02] 마지막 페이지(M >= total): M = total 로 표시하고 [다음] 은 비활성, [이전] 은 이전 page 로 바꾼다", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pager page={3} limit={50} total={120} onPageChange={onPageChange} />);

    expect(screen.getByText("101–120 / 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NEXT })).toBeDisabled();
    expect(screen.getByRole("button", { name: PREV })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: PREV }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("[CT-07] total 이 limit 의 배수일 때 마지막 페이지에서 [다음] 이 비활성이다 (limit 20)", () => {
    render(<Pager page={2} limit={20} total={40} onPageChange={vi.fn()} />);

    expect(screen.getByText("21–40 / 40")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NEXT })).toBeDisabled();
  });

  it("[CT-02] isDisabled 면 범위 표시는 그대로 두고 [이전]/[다음] 을 모두 비활성으로 둔다 (S-17)", () => {
    const { rerender } = render(<Pager page={2} limit={50} total={120} onPageChange={vi.fn()} isDisabled />);

    expect(screen.getByText("51–100 / 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PREV })).toBeDisabled();
    expect(screen.getByRole("button", { name: NEXT })).toBeDisabled();

    rerender(<Pager page={2} limit={50} total={120} onPageChange={vi.fn()} isDisabled={false} />);
    expect(screen.getByRole("button", { name: PREV })).toBeEnabled();
    expect(screen.getByRole("button", { name: NEXT })).toBeEnabled();
  });

  it("[CT-02][CT-07] total 이 0 이면 페이저를 숨기고, 0 보다 크면 표시한다", () => {
    const { rerender } = render(<Pager page={1} limit={20} total={0} onPageChange={vi.fn()} />);

    expect(screen.queryByRole("button", { name: PREV })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: NEXT })).not.toBeInTheDocument();

    rerender(<Pager page={1} limit={20} total={5} onPageChange={vi.fn()} />);

    expect(screen.getByText("1–5 / 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NEXT })).toBeDisabled();
  });
});
