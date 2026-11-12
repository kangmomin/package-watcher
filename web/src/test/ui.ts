// 화면 테스트 공용 조회·조작 헬퍼.
import { toDetails } from "@pw/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { ZodType } from "zod";

// ---------------------------------------------------------------- 시간

/** 남은 비동기 작업(응답 처리, toast 표시)을 흘려보낸다. 가짜 시계면 시계를 진행시킨다. */
export async function settle(ms = 50): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(ms);
    } else {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  });
}

/** 가짜 시계를 ms 만큼 진행시킨다 (polling, debounce 검증용). */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// ---------------------------------------------------------------- toast (sonner)

function toastElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-sonner-toast]"));
}

export function getToastTexts(): string[] {
  return toastElements().map((element) => element.textContent?.trim() ?? "");
}

function textMatches(actual: string, expected: string | RegExp): boolean {
  return typeof expected === "string" ? actual.includes(expected) : expected.test(actual);
}

/** 문구를 포함하는 toast 가 나타날 때까지 기다린다. */
export async function findToast(text: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const toast = toastElements().find((element) => textMatches(element.textContent ?? "", text));
    if (!toast) {
      throw new Error(`toast 를 찾지 못했습니다: ${String(text)} / 현재 toast: ${JSON.stringify(getToastTexts())}`);
    }
    return toast;
  });
}

/** 잠시 기다린 뒤 toast 가 하나도 없음을 확인한다. */
export async function expectNoToast(): Promise<void> {
  await settle();
  expect(getToastTexts()).toEqual([]);
}

// ---------------------------------------------------------------- 표

/**
 * 텍스트가 정확히 `text` 인 요소(getByText 규칙)를 가진 표 행 1개. 없거나 여러 개면 throw.
 * 셀 안에 아이콘 버튼 등이 함께 있어도 찾을 수 있다.
 */
export function getRowWith(text: string, container: HTMLElement = document.body): HTMLElement {
  const rows = within(container)
    .queryAllByRole("row")
    .filter((row) => within(row).queryAllByText(text).length > 0);
  if (rows.length !== 1) {
    throw new Error(`"${text}" 를 가진 행이 ${rows.length}개입니다 (1개여야 함)`);
  }
  return rows[0] as HTMLElement;
}

export async function findRowWith(text: string, container?: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => getRowWith(text, container));
}

/** 부분 일치 matcher (getByText 등에 쓴다). 정규식 특수 문자는 그대로 비교한다. */
export function containing(text: string): RegExp {
  return new RegExp(escapeRegExp(text));
}

// ---------------------------------------------------------------- loading

/** shadcn Skeleton (`data-slot="skeleton"`) */
export function queryAllSkeletons(container: ParentNode = document.body): Element[] {
  return Array.from(container.querySelectorAll('[data-slot="skeleton"]'));
}

// ---------------------------------------------------------------- 폼

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 필드 오류가 그 필드에 연결되어 있다(aria-describedby → accessible description). */
export async function expectFieldError(field: HTMLElement, message: string): Promise<void> {
  await waitFor(() => {
    expect(field).toHaveAccessibleDescription(containing(message));
  });
}

/**
 * shared 스키마가 입력에 대해 내는 필드별 첫 오류 문구(`toDetails`).
 * "제출 전 shared 스키마로 검증" 의 기대 문구를 스키마에서 직접 얻는다.
 */
export function schemaErrors(schema: ZodType, input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("검증이 실패해야 하는 입력입니다");
  return toDetails(result.error);
}

/**
 * select 의 옵션을 고른다. 네이티브 `<select>` 와 Radix Select(combobox + listbox) 를 모두 지원한다.
 */
export async function chooseOption(user: UserEvent, combobox: HTMLElement, option: string): Promise<void> {
  if (combobox instanceof HTMLSelectElement) {
    await user.selectOptions(combobox, option);
    return;
  }
  await user.click(combobox);
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: option }));
}
