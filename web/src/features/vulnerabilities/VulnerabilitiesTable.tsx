// "취약점" 탭의 표: 패키지별 1줄. 행을 열면(펼침) 그때 상세를 조회한다.
// 열: 종류 | 패키지(펼침 버튼) | 최고 점수 | 권고 | repo | 검출 | 고쳐진 버전 | 직접.
import type { VulnerabilityGroup } from "@pw/shared";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, useId, useState } from "react";
import { DashText } from "@/components/DashText";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VulnerabilityDetail } from "@/features/vulnerabilities/VulnerabilityDetail";
import {
  NOT_APPLICABLE_SR_TEXT,
  ecosystemLabel,
  formatCvssScore,
  formatPatchedVersions,
} from "@/lib/format";

export interface VulnerabilitiesTableProps {
  items: VulnerabilityGroup[];
}

const COLUMN_COUNT = 8;

function groupKey(group: Pick<VulnerabilityGroup, "ecosystem" | "packageName">): string {
  return `${group.ecosystem}\u0000${group.packageName}`;
}

export function VulnerabilitiesTable({ items }: VulnerabilitiesTableProps) {
  const id = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="rounded-lg border">
      <Table aria-label="취약점 목록">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">종류</TableHead>
            <TableHead scope="col">패키지</TableHead>
            <TableHead scope="col">최고 점수</TableHead>
            <TableHead scope="col">권고</TableHead>
            <TableHead scope="col">repo</TableHead>
            <TableHead scope="col">검출</TableHead>
            <TableHead scope="col">고쳐진 버전</TableHead>
            <TableHead scope="col">직접 의존성</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((group, index) => {
            const key = groupKey(group);
            const isOpen = expanded.has(key);
            const detailId = `${id}-${index}-detail`;
            return (
              <Fragment key={key}>
                <TableRow data-state={isOpen ? "selected" : undefined}>
                  <TableCell>{ecosystemLabel(group.ecosystem)}</TableCell>
                  <TableCell className="max-w-72 font-mono text-xs">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      onClick={() => toggle(key)}
                      title={group.packageName}
                      className="flex w-full items-center gap-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {isOpen ? (
                        <ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{group.packageName}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatCvssScore(group.maxScore)}</span>
                      <SeverityBadge severity={group.severity} />
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{group.advisoryCount}</TableCell>
                  <TableCell className="tabular-nums">{group.repoCount}</TableCell>
                  <TableCell className="tabular-nums">{group.findingCount}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs" title={formatPatchedVersions(group.patchedVersions)}>
                    {formatPatchedVersions(group.patchedVersions)}
                  </TableCell>
                  <TableCell>
                    {group.hasDirect ? (
                      <Badge variant="outline">직접</Badge>
                    ) : (
                      <DashText srText={NOT_APPLICABLE_SR_TEXT} />
                    )}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell id={detailId} colSpan={COLUMN_COUNT} className="whitespace-normal">
                      <VulnerabilityDetail group={group} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
