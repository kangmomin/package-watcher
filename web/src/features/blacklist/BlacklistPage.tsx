// 블랙리스트 `/blacklist`.
// 구성: 필터 + [가져오기] [내보내기] [항목 추가] + 일괄 버튼 줄 + BlacklistTable + BlacklistDialog(추가/수정 공용) + DeleteConfirm + ImportDialog.
// empty = 필터가 없으면 "블랙리스트가 비어 있습니다", 있으면 "조건에 맞는 항목이 없습니다".
import { isUserManagedEcosystem, type BlacklistEntry } from "@pw/shared";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DataState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { BlacklistDialog } from "@/features/blacklist/BlacklistDialog";
import { BlacklistFilters } from "@/features/blacklist/BlacklistFilters";
import { BlacklistTable } from "@/features/blacklist/BlacklistTable";
import { BulkActions } from "@/features/blacklist/BulkActions";
import { DeleteConfirm } from "@/features/blacklist/DeleteConfirm";
import { ExportMenu } from "@/features/blacklist/ExportMenu";
import { ImportDialog } from "@/features/blacklist/ImportDialog";
import { useBlacklist, useBulkBlacklist } from "@/features/blacklist/hooks";
import type { BlacklistFilter } from "@/lib/api";
import { firstLoadState } from "@/lib/queryState";

export function BlacklistPage() {
  const [filter, setFilter] = useState<BlacklistFilter>({});
  const blacklist = useBlacklist(filter);
  const data = blacklist.data;
  const bulk = useBulkBlacklist();
  const hasFilter =
    filter.ecosystem !== undefined ||
    filter.status !== undefined ||
    filter.source !== undefined ||
    filter.q !== undefined;

  // 닫을 때 editing 을 비우지 않는다: 닫히는 동안 제목이 "추가" 로 바뀌지 않게 한다.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BlacklistEntry | null>(null);
  const [deleting, setDeleting] = useState<BlacklistEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const openDialog = (entry: BlacklistEntry | null) => {
    setEditing(entry);
    setDialogOpen(true);
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  // 보이는 행의 id 만 선택으로 센다. 일괄 요청도 이 값을 쓰므로 낡은 id 를 보내지 않는다.
  const selectedIds = useMemo(
    () => items.filter((entry) => selected.has(entry.id)).map((entry) => entry.id),
    [items, selected],
  );
  const visibleSelected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // 목록이 바뀌어 보이지 않게 된 id 는 선택 상태에서도 지운다(필터를 되돌려도 되살아나지 않게).
  // 렌더 중에 맞추면 낡은 선택이 한 번도 그려지지 않는다.
  if (data && visibleSelected.size !== selected.size) setSelected(visibleSelected);

  const toggle = (id: number, checked: boolean) => {
    const next = new Set(visibleSelected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const clearSelected = (removed: number[]) =>
    setSelected((prev) => new Set([...prev].filter((id) => !removed.includes(id))));
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(items.map((entry) => entry.id)) : new Set());

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">블랙리스트</h1>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <BlacklistFilters filter={filter} onFilterChange={setFilter} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon aria-hidden="true" />
            가져오기
          </Button>
          <ExportMenu filter={filter} />
          <Button onClick={() => openDialog(null)}>
            <PlusIcon aria-hidden="true" />
            항목 추가
          </Button>
        </div>
      </div>
      <BulkActions
        ids={selectedIds}
        onClear={clearSelected}
        hasBuiltIn={items.some((entry) => visibleSelected.has(entry.id) && !isUserManagedEcosystem(entry.ecosystem))}
        disabled={blacklist.isPlaceholderData}
        bulk={bulk}
      />
      <DataState
        {...firstLoadState(blacklist)}
        isEmpty={data?.items.length === 0}
        emptyMessage={hasFilter ? "조건에 맞는 항목이 없습니다" : "블랙리스트가 비어 있습니다"}
        onRetry={() => void blacklist.refetch()}
      >
        {data && (
          <BlacklistTable
            items={data.items}
            onEdit={openDialog}
            onDelete={setDeleting}
            selectedIds={visibleSelected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            selectionDisabled={blacklist.isPlaceholderData || bulk.isPending}
            busy={blacklist.isPlaceholderData}
          />
        )}
      </DataState>
      <BlacklistDialog open={dialogOpen} entry={editing} onOpenChange={setDialogOpen} />
      <DeleteConfirm
        entry={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
