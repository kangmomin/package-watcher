// 블랙리스트 표.
// 열: 선택(체크박스), 종류, 이름, 버전 범위(null = "(모든 버전)"), 심각도, 상태(켬/끔/만료), 만료일(null = "-"), 사유, 수정, 삭제.
// 아이콘 버튼은 aria-label 로 이름을 준다.
// 접근성: 이름 셀이 행 헤더다. 수정·삭제 버튼은 이름을 바꾸지 않고 이름 셀을 설명으로 연결한다.
import { entryStatusOf, type BlacklistEntry, type EntryStatus } from "@pw/shared";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_VERSIONS_LABEL, entryStatusLabel } from "@/lib/format";

export interface BlacklistTableProps {
  items: BlacklistEntry[];
  onEdit: (entry: BlacklistEntry) => void;
  onDelete: (entry: BlacklistEntry) => void;
  /** 보이는 행 중 선택한 id */
  selectedIds: ReadonlySet<number>;
  onToggle: (id: number, checked: boolean) => void;
  /** 머리글의 "모두 선택": true = 보이는 행 전체 선택, false = 해제 */
  onToggleAll: (checked: boolean) => void;
}

const ENTRY_STATUS_CLASSES: Record<EntryStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  disabled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  expired: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

export function BlacklistTable({
  items,
  onEdit,
  onDelete,
  selectedIds,
  onToggle,
  onToggleAll,
}: BlacklistTableProps) {
  const id = useId();
  const selectedCount = items.filter((entry) => selectedIds.has(entry.id)).length;
  const allChecked = items.length > 0 && selectedCount === items.length;
  return (
    <div className="rounded-lg border">
      <Table aria-label="블랙리스트">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-10">
              <Checkbox
                aria-label="모두 선택"
                checked={allChecked ? true : selectedCount > 0 ? "indeterminate" : false}
                onCheckedChange={() => onToggleAll(!allChecked)}
              />
            </TableHead>
            <TableHead scope="col">종류</TableHead>
            <TableHead scope="col">패키지 이름</TableHead>
            <TableHead scope="col">버전 범위</TableHead>
            <TableHead scope="col">심각도</TableHead>
            <TableHead scope="col">상태</TableHead>
            <TableHead scope="col">만료일</TableHead>
            <TableHead scope="col">사유</TableHead>
            <TableHead scope="col" className="w-16 text-center">
              수정
            </TableHead>
            <TableHead scope="col" className="w-16 text-center">
              삭제
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry) => {
            const nameId = `${id}-${entry.id}-name`;
            const status = entryStatusOf(entry);
            return (
              <TableRow key={entry.id} data-state={selectedIds.has(entry.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`${entry.name} 선택`}
                    checked={selectedIds.has(entry.id)}
                    onCheckedChange={(checked) => onToggle(entry.id, checked === true)}
                  />
                </TableCell>
                <TableCell>{entry.ecosystem}</TableCell>
                <RowHeaderCell id={nameId} className="font-mono text-xs font-medium">
                  {entry.name}
                </RowHeaderCell>
                <TableCell className="font-mono text-xs">
                  {entry.versionRange ?? (
                    <span className="font-sans text-muted-foreground">{ALL_VERSIONS_LABEL}</span>
                  )}
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={entry.severity} />
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={ENTRY_STATUS_CLASSES[status]}>
                    {entryStatusLabel(status)}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.expiresAt ?? "-"}</TableCell>
                <TableCell className="max-w-96 whitespace-normal">{entry.reason}</TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="수정"
                    aria-describedby={nameId}
                    title={`${entry.name} 수정`}
                    onClick={() => onEdit(entry)}
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="삭제"
                    aria-describedby={nameId}
                    title={`${entry.name} 삭제`}
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(entry)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
