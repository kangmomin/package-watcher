// 삭제 확인 Dialog.
// 요청 중 [삭제] 비활성 + 닫기 불가. 성공 또는 NOT_FOUND → 닫기, 그 외 → 열어 둠.
import type { BlacklistEntry } from "@pw/shared";
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
import { useDeleteBlacklistEntry } from "@/features/blacklist/hooks";
import { errorToastMessage, hasErrorCode } from "@/lib/errors";

export interface DeleteConfirmProps {
  /** null 이면 닫힌 상태 */
  entry: BlacklistEntry | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteConfirm({ entry, onOpenChange }: DeleteConfirmProps) {
  const remove = useDeleteBlacklistEntry();
  // 닫히는 애니메이션 동안에도 문구가 비지 않게 마지막 항목을 기억한다.
  const [shown, setShown] = useState(entry);
  if (entry !== null && entry !== shown) setShown(entry);

  const handleOpenChange = (next: boolean) => {
    if (!next && remove.isPending) return;
    onOpenChange(next);
  };

  const handleDelete = () => {
    if (!entry) return;
    remove.mutate(entry.id, {
      onSuccess: () => {
        toast.success("항목을 삭제했습니다");
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(errorToastMessage(error));
        if (hasErrorCode(error, "NOT_FOUND")) onOpenChange(false);
      },
    });
  };

  return (
    <AlertDialog open={entry !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>블랙리스트 항목을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            {shown && (
              <>
                <span className="font-mono">{shown.name}</span> {shown.versionRange ?? "(모든 버전)"} 항목을
                삭제합니다. 이 항목의 open·ignored 검출은 resolved 로 바뀝니다.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>취소</AlertDialogCancel>
          {/* AlertDialogAction 은 누르면 바로 닫힌다. 결과를 보고 닫아야 하므로 일반 버튼을 쓴다. */}
          <Button variant="destructive" disabled={remove.isPending} onClick={handleDelete}>
            삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
