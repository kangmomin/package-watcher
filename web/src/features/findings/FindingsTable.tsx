// 검출 표 + 행 메뉴.
// 행 메뉴: open = 무시 + GitHub에서 보기 / ignored = 다시 열기 + GitHub에서 보기 / resolved = GitHub에서 보기만.
// PATCH 중 그 행 메뉴 비활성.
import type { Finding } from "@pw/shared";
import { EllipsisVerticalIcon, EyeOffIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react";
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
import { dependencyTypeLabel } from "@/lib/format";

export interface FindingsTableProps {
  items: Finding[];
}

interface RowMenuProps {
  finding: Finding;
  isDisabled: boolean;
  onChangeStatus: (status: SetFindingStatusVariables["status"]) => void;
}

export function FindingsTable({ items }: FindingsTableProps) {
  const setStatus = useSetFindingStatus();
  const pendingIds = usePendingFindingIds();

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>repo</TableHead>
            <TableHead>파일 경로</TableHead>
            <TableHead>패키지@버전</TableHead>
            <TableHead>종류</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">메뉴</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((finding) => (
            <TableRow key={finding.id}>
              <TableCell className="font-medium">{finding.repo}</TableCell>
              <TableCell className="max-w-64 truncate" title={finding.filePath}>
                {finding.filePath}
              </TableCell>
              <TableCell className="font-mono text-xs">{`${finding.packageName}@${finding.version}`}</TableCell>
              <TableCell>{dependencyTypeLabel(finding.dependencyType)}</TableCell>
              <TableCell>
                <StatusBadge status={finding.status} />
              </TableCell>
              <TableCell>
                <RowMenu
                  finding={finding}
                  isDisabled={pendingIds.has(finding.id)}
                  onChangeStatus={(status) => setStatus.mutate({ id: finding.id, status })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RowMenu({ finding, isDisabled, onChangeStatus }: RowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isDisabled}>
        <Button variant="ghost" size="icon-sm" aria-label="행 메뉴">
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
          <a href={finding.htmlUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon aria-hidden="true" />
            GitHub에서 보기
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
