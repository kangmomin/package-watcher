// 표 아래 페이저 `[이전] N–M / total [다음]` (A-8).
// 계약: total === 0 이면 숨긴다. N = (page−1)×limit+1, M = min(page×limit, total).
// [이전] 은 page === 1, [다음] 은 M >= total 일 때 비활성.
// isDisabled: 이전 응답을 보여 주는 동안(S-17)은 두 버튼을 모두 비활성으로 둔다.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PagerProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  /** true 면 [이전]/[다음] 을 비활성으로 둔다 (표시 중인 값이 아직 지금 page 의 응답이 아닐 때) */
  isDisabled?: boolean;
}

export function Pager({ page, limit, total, onPageChange, isDisabled = false }: PagerProps) {
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav aria-label="페이지" className="flex items-center justify-end gap-3 text-sm">
      <Button
        variant="outline"
        size="sm"
        disabled={isDisabled || page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
        이전
      </Button>
      <span className="tabular-nums text-muted-foreground" aria-live="polite">
        {`${first}–${last} / ${total}`}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={isDisabled || last >= total}
        onClick={() => onPageChange(page + 1)}
      >
        다음
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </nav>
  );
}
