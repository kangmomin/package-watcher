// 일괄 버튼 줄: "선택 n건:" + [켜기] [끄기] [삭제]. 1건 이상 선택했을 때만 버튼을 보인다.
// [켜기]·[끄기] 는 바로 실행하고, [삭제] 는 건수를 보여 주는 확인 Dialog 뒤에 실행한다.
// 건수 span 은 항상 렌더해 두어야 스크린 리더가 변경을 읽는다(aria-live).
import type { BulkAction } from "@pw/shared";
import { useState } from "react";
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
import { useBulkBlacklist } from "@/features/blacklist/hooks";
import { errorToastMessage, hasErrorCode } from "@/lib/errors";

export interface BulkActionsProps {
  /** 지금 보이는 행 중 선택한 id (표 순서) */
  ids: number[];
  onClear: () => void;
}

const SUCCESS_MESSAGE: Record<BulkAction, (count: number) => string> = {
  enable: (count) => `${count}건을 켰습니다`,
  disable: (count) => `${count}건을 껐습니다`,
  delete: (count) => `${count}건을 삭제했습니다`,
};

export function BulkActions({ ids, onClear }: BulkActionsProps) {
  const bulk = useBulkBlacklist();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 확인 Dialog 가 닫히는 동안 건수가 0 으로 바뀌지 않게 연 시점의 건수를 쓴다.
  const [confirmCount, setConfirmCount] = useState(0);

  const run = (action: BulkAction) => {
    bulk.mutate(
      { action, ids },
      {
        onSuccess: (result) => {
          toast.success(SUCCESS_MESSAGE[result.action](result.count));
          onClear();
        },
        onError: (error) => {
          toast.error(errorToastMessage(error));
          // 없는 항목이 있었다면 선택이 이미 낡았다. 결과를 알 수 없는 오류는 선택을 유지해 다시 시도할 수 있게 한다.
          if (hasErrorCode(error, "NOT_FOUND")) onClear();
        },
        onSettled: () => setConfirmingDelete(false),
      },
    );
  };

  const pending = bulk.isPending;
  return (
    <div role="group" aria-label="일괄 작업" className="flex items-center gap-2">
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {ids.length > 0 && `선택 ${ids.length}건:`}
      </span>
      {ids.length > 0 && (
        <>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run("enable")}>
            켜기
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run("disable")}>
            끄기
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              setConfirmCount(ids.length);
              setConfirmingDelete(true);
            }}
          >
            삭제
          </Button>
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
              선택한 {confirmCount}건을 삭제합니다. 이 항목들의 검출은 resolved로 바뀝니다
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
            {/* AlertDialogAction 은 누르면 바로 닫힌다. 결과를 보고 닫아야 하므로 일반 버튼을 쓴다. */}
            <Button variant="destructive" disabled={pending} onClick={() => run("delete")}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
