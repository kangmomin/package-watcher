// 블랙리스트 `/blacklist`.
// 구성: [항목 추가] + BlacklistTable + BlacklistDialog(추가/수정 공용) + DeleteConfirm.
// empty = "블랙리스트가 비어 있습니다".
import type { BlacklistEntry } from "@pw/shared";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { DataState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { BlacklistDialog } from "@/features/blacklist/BlacklistDialog";
import { BlacklistTable } from "@/features/blacklist/BlacklistTable";
import { DeleteConfirm } from "@/features/blacklist/DeleteConfirm";
import { useBlacklist } from "@/features/blacklist/hooks";
import { firstLoadState } from "@/lib/queryState";

export function BlacklistPage() {
  const blacklist = useBlacklist();
  const data = blacklist.data;

  // 닫을 때 editing 을 비우지 않는다: 닫히는 동안 제목이 "추가" 로 바뀌지 않게 한다.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BlacklistEntry | null>(null);
  const [deleting, setDeleting] = useState<BlacklistEntry | null>(null);

  const openDialog = (entry: BlacklistEntry | null) => {
    setEditing(entry);
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">블랙리스트</h1>
        <Button onClick={() => openDialog(null)}>
          <PlusIcon aria-hidden="true" />
          항목 추가
        </Button>
      </div>
      <DataState
        {...firstLoadState(blacklist)}
        isEmpty={data?.items.length === 0}
        emptyMessage="블랙리스트가 비어 있습니다"
        onRetry={() => void blacklist.refetch()}
      >
        {data && <BlacklistTable items={data.items} onEdit={openDialog} onDelete={setDeleting} />}
      </DataState>
      <BlacklistDialog open={dialogOpen} entry={editing} onOpenChange={setDialogOpen} />
      <DeleteConfirm
        entry={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </div>
  );
}
