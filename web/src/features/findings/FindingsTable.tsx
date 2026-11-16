// 검출 표 + 행 메뉴.
// 행 메뉴: open = 무시 + GitHub에서 보기 / ignored = 다시 열기 + GitHub에서 보기 / resolved = GitHub에서 보기만.
// PATCH 중 그 행 메뉴 비활성.
// 접근성: repo 셀이 행 헤더다. 행 메뉴 버튼은 이름("행 메뉴")을 바꾸지 않고 repo + 패키지 셀을 설명으로 연결한다.
import type { Finding } from "@pw/shared";
import { EllipsisVerticalIcon, EyeOffIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react";
import { useId } from "react";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { SeverityBadge } from "@/components/SeverityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePendingFindingIds, useSetFindingStatus, type SetFindingStatusVariables } from "@/features/findings/hooks";
import { NOT_APPLICABLE_LABEL, dependencyTypeLabel, ecosystemLabel } from "@/lib/format";

export interface FindingsTableProps {
  items: Finding[];
}

interface RowMenuProps {
  finding: Finding;
  isDisabled: boolean;
  /** 행을 식별하는 셀 id 들 (aria-describedby) */
  describedBy: string;
  onChangeStatus: (status: SetFindingStatusVariables["status"]) => void;
}

export function FindingsTable({ items }: FindingsTableProps) {
  const id = useId();
  const setStatus = useSetFindingStatus();
  const pendingIds = usePendingFindingIds();

  return (
    <div className="rounded-lg border">
      <Table aria-label="검출 목록">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">repo</TableHead>
            <TableHead scope="col">파일 경로</TableHead>
            <TableHead scope="col">종류</TableHead>
            <TableHead scope="col">패키지@버전</TableHead>
            <TableHead scope="col">심각도</TableHead>
            <TableHead scope="col">직접/전이</TableHead>
            <TableHead scope="col">상태</TableHead>
            <TableHead scope="col" className="w-12">
              <span className="sr-only">메뉴</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((finding) => {
            const repoId = `${id}-${finding.id}-repo`;
            const packageId = `${id}-${finding.id}-package`;
            return (
              <TableRow key={finding.id}>
                <RowHeaderCell id={repoId} className="font-medium">
                  {finding.repo}
                </RowHeaderCell>
                <TableCell className="max-w-64 truncate" title={finding.filePath}>
                  {finding.filePath}
                </TableCell>
                <TableCell>{ecosystemLabel(finding.ecosystem)}</TableCell>
                <TableCell id={packageId} className="font-mono text-xs">
                  {`${finding.packageName}@${finding.version === "" ? NOT_APPLICABLE_LABEL : finding.version}`}
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={finding.severity} />
                </TableCell>
                <TableCell>{dependencyTypeLabel(finding.dependencyType)}</TableCell>
                <TableCell>
                  <StatusBadge status={finding.status} />
                </TableCell>
                <TableCell>
                  <RowMenu
                    finding={finding}
                    isDisabled={pendingIds.has(finding.id)}
                    describedBy={`${repoId} ${packageId}`}
                    onChangeStatus={(status) => setStatus.mutate({ id: finding.id, status })}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RowMenu({ finding, isDisabled, describedBy, onChangeStatus }: RowMenuProps) {
  const newTabHintId = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isDisabled}>
        <Button variant="ghost" size="icon-sm" aria-label="행 메뉴" aria-describedby={describedBy}>
          <EllipsisVerticalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {finding.status === "open" && (
          <DropdownMenuItem onSelect={() => onChangeStatus("ignored")}>
            <EyeOffIcon aria-hidden="true" />
            무시
          </DropdownMenuItem>
        )}
        {finding.status === "ignored" && (
          <DropdownMenuItem onSelect={() => onChangeStatus("open")}>
            <RotateCcwIcon aria-hidden="true" />
            다시 열기
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          {/* 새 탭 안내는 이름(텍스트)을 바꾸지 않도록 설명(aria-describedby)으로 연결한다. */}
          <a href={finding.htmlUrl} target="_blank" rel="noreferrer" aria-describedby={newTabHintId}>
            <ExternalLinkIcon aria-hidden="true" />
            GitHub에서 보기
          </a>
        </DropdownMenuItem>
        <span id={newTabHintId} hidden>
          새 탭에서 열림
        </span>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
