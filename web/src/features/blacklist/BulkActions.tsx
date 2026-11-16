// 일괄 버튼 줄: "선택 n건:" + [켜기] [끄기] [삭제]. 1건 이상 선택했을 때만 버튼을 보인다.
// [켜기]·[끄기] 는 바로 실행하고, [삭제] 는 건수를 보여 주는 확인 Dialog 뒤에 실행한다.
// 건수 span 은 항상 렌더해 두어야 스크린 리더가 변경을 읽는다(aria-live).
import { BULK_MAX_IDS, type BulkAction } from "@pw/shared";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { useBulkBlacklist } from "@/features/blacklist/hooks";
import { errorToastMessage, hasErrorCode } from "@/lib/errors";

export interface BulkActionsProps {
  /** 지금 보이는 행 중 선택한 id (표 순서) */
  ids: number[];
  /** 요청한 id 를 선택에서 뺀다 */
  onClear: (removed: number[]) => void;
  /** 선택에 내장 검사(policy)가 있다 — 삭제할 수 없다 */
  hasBuiltIn?: boolean;
  /** 목록이 아직 확인되지 않았다(필터 변경 직후) */
  disabled?: boolean;
  /** 요청 상태를 화면(체크박스)과 나누기 위해 화면이 만든 mutation 을 받는다 */
  bulk: ReturnType<typeof useBulkBlacklist>;
}

const SUCCESS_MESSAGE: Record<BulkAction, (count: number) => string> = {
  enable: (count) => `${count}건을 켰습니다`,
  disable: (count) => `${count}건을 껐습니다`,
  delete: (count) => `${count}건을 삭제했습니다`,
};

const BUILT_IN_DELETE_HINT = "내장 검사가 선택돼 있어서 삭제할 수 없습니다";

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function BulkActions({ ids, onClear, hasBuiltIn = false, disabled = false, bulk }: BulkActionsProps) {
  const builtInHintId = useId();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 확인 Dialog 가 닫히는 동안 건수가 0 으로 바뀌지 않게 연 시점의 건수를 쓴다.
  const [confirmIds, setConfirmIds] = useState<number[]>([]);

  // 확인 Dialog 를 연 뒤 선택이 바뀌면(목록이 바뀜) 표시한 건수가 맞지 않으므로 닫는다.
  if (confirmingDelete && !sameIds(confirmIds, ids)) setConfirmingDelete(false);

  const run = (action: BulkAction, targetIds: number[]) => {
    bulk.mutate(
      { action, ids: targetIds },
      {
        onSuccess: (result) => {
          toast.success(SUCCESS_MESSAGE[result.action](result.count));
          onClear(targetIds);
        },
        onError: (error) => {
          toast.error(errorToastMessage(error));
          // 없는 항목이 있었다면 선택이 이미 낡았다. 결과를 알 수 없는 오류는 선택을 유지해 다시 시도할 수 있게 한다.
          if (hasErrorCode(error, "NOT_FOUND")) onClear(targetIds);
        },
        onSettled: () => setConfirmingDelete(false),
      },
    );
  };

  const pending = bulk.isPending;
  const tooMany = ids.length > BULK_MAX_IDS;
  const buttonsDisabled = pending || disabled || tooMany;
  return (
    <div role="group" aria-label="일괄 작업" className="flex items-center gap-2">
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {ids.length > 0 && `선택 ${ids.length}건:`}
      </span>
      {ids.length > 0 && (
        <>
          <Button variant="outline" size="sm" disabled={buttonsDisabled} onClick={() => run("enable", ids)}>
            켜기
          </Button>
          <Button variant="outline" size="sm" disabled={buttonsDisabled} onClick={() => run("disable", ids)}>
            끄기
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={buttonsDisabled || hasBuiltIn}
            aria-describedby={hasBuiltIn ? builtInHintId : undefined}
            onClick={() => {
              setConfirmIds(ids);
              setConfirmingDelete(true);
            }}
          >
            삭제
          </Button>
          {hasBuiltIn && (
            <span id={builtInHintId} className="text-sm text-muted-foreground">
              {BUILT_IN_DELETE_HINT}
            </span>
          )}
          {tooMany && (
            <span className="text-sm text-destructive">
              한 번에 {BULK_MAX_IDS}건까지 처리할 수 있습니다
            </span>
          )}
        </>
      )}
      <AlertDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmingDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>선택한 항목을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 {confirmIds.length}건을 삭제합니다. 이 항목들의 검출은 resolved로 바뀝니다
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            {/* AlertDialogAction 은 누르면 바로 닫힌다. 결과를 보고 닫아야 하므로 일반 버튼을 쓴다. */}
            <Button variant="destructive" disabled={pending} onClick={() => run("delete", confirmIds)}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
