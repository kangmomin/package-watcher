// 블랙리스트 표.
// 열: 선택(체크박스), 종류, 이름, 버전 범위(null = "(모든 버전)"), 심각도, 상태(켬/끔/만료), 만료일(null = "-"), 사유, 수정, 삭제.
// 아이콘 버튼은 aria-label 로 이름을 준다.
// 접근성: 이름 셀이 행 헤더다. 수정·삭제 버튼은 이름을 바꾸지 않고 이름 셀을 설명으로 연결한다.
import {
  entryStatusOf,
  isUserManagedEcosystem,
  usesVersionRange,
  type BlacklistEntry,
  type EntryStatus,
} from "@pw/shared";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { DashText } from "@/components/DashText";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ALL_VERSIONS_LABEL,
  NOT_APPLICABLE_SR_TEXT,
  ecosystemLabel,
  entryStatusLabel,
  policyCheckTitle,
} from "@/lib/format";

export interface BlacklistTableProps {
  items: BlacklistEntry[];
  onEdit: (entry: BlacklistEntry) => void;
  onDelete: (entry: BlacklistEntry) => void;
  /** 보이는 행 중 선택한 id */
  selectedIds: ReadonlySet<number>;
  onToggle: (id: number, checked: boolean) => void;
  /** 머리글의 "모두 선택": true = 보이는 행 전체 선택, false = 해제 */
  onToggleAll: (checked: boolean) => void;
  /** 체크박스 비활성 (일괄 요청 중, 목록 미확인) */
  selectionDisabled?: boolean;
  /** 목록이 아직 지금의 필터 응답이 아니다 */
  busy?: boolean;
}

/** 내장 검사(policy) 행의 삭제 버튼이 비활성인 이유 */
const POLICY_NO_DELETE_LABEL = "내장 검사는 삭제할 수 없습니다";

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
  selectionDisabled = false,
  busy = false,
}: BlacklistTableProps) {
  const id = useId();
  const selectedCount = items.filter((entry) => selectedIds.has(entry.id)).length;
  const allChecked = items.length > 0 && selectedCount === items.length;
  return (
    <div className="rounded-lg border">
      <Table aria-label="블랙리스트" aria-busy={busy || undefined}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-10">
              <Checkbox
                aria-label="모두 선택"
                disabled={selectionDisabled}
                checked={allChecked ? true : selectedCount > 0 ? "indeterminate" : false}
                onCheckedChange={() => onToggleAll(!allChecked)}
              />
            </TableHead>
            <TableHead scope="col">종류</TableHead>
            <TableHead scope="col">이름</TableHead>
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
            // 사람이 읽는 이름: 내장 검사는 id 가 아니라 title
            const label = isUserManagedEcosystem(entry.ecosystem) ? entry.name : policyCheckTitle(entry.name);
            return (
              <TableRow
                key={entry.id}
                data-state={selectedIds.has(entry.id) ? "selected" : undefined}
              >
                <TableCell>
                  <Checkbox
                    aria-label={`${label} 선택`}
                    disabled={selectionDisabled}
                    checked={selectedIds.has(entry.id)}
                    onCheckedChange={(checked) => onToggle(entry.id, checked === true)}
                  />
                </TableCell>
                <TableCell>{ecosystemLabel(entry.ecosystem)}</TableCell>
                <RowHeaderCell
                  id={nameId}
                  className={
                    isUserManagedEcosystem(entry.ecosystem)
                      ? "max-w-64 truncate font-mono text-xs font-medium"
                      : "max-w-64 font-medium whitespace-normal"
                  }
                  title={entry.name}
                >
                  {isUserManagedEcosystem(entry.ecosystem) ? (
                    entry.name
                  ) : (
                    // 내장 검사: 사람이 읽는 title 을 크게, id 를 작게 보인다.
                    <>
                      <span className="block font-sans text-sm">{policyCheckTitle(entry.name)}</span>
                      <span className="block text-xs font-normal text-muted-foreground">{entry.name}</span>
                    </>
                  )}
                </RowHeaderCell>
                <TableCell className="font-mono text-xs">
                  {!usesVersionRange(entry.ecosystem) ? (
                    <span className="font-sans text-muted-foreground">
                      <DashText srText={NOT_APPLICABLE_SR_TEXT} />
                    </span>
                  ) : (
                    (entry.versionRange ?? (
                      <span className="font-sans text-muted-foreground">{ALL_VERSIONS_LABEL}</span>
                    ))
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
                <TableCell className="max-w-96 whitespace-normal [overflow-wrap:anywhere]">{entry.reason}</TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="수정"
                    aria-describedby={nameId}
                    title={`${label} 수정`}
                    onClick={() => onEdit(entry)}
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={isUserManagedEcosystem(entry.ecosystem) ? "삭제" : POLICY_NO_DELETE_LABEL}
                    aria-describedby={nameId}
                    title={isUserManagedEcosystem(entry.ecosystem) ? `${label} 삭제` : POLICY_NO_DELETE_LABEL}
                    disabled={!isUserManagedEcosystem(entry.ecosystem)}
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
