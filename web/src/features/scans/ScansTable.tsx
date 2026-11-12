// 스캔 이력 표.
// 열: 시작 시각, 종류(자동/수동), 상태, repo 수, 신규, 실패(failedRepos.length). running 행은 repo 수·신규·실패 = "-".
// 행 펼침 = 목록 데이터의 error(null 아니면) + failedRepos. 둘 다 비면 펼칠 수 없다.
import type { Scan } from "@pw/shared";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useId, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatTableTime, scanTriggerLabel } from "@/lib/format";

export interface ScansTableProps {
  items: Scan[];
}

const COLUMN_COUNT = 7;

function canExpand(scan: Scan): boolean {
  return scan.error !== null || scan.failedRepos.length > 0;
}

export function ScansTable({ items }: ScansTableProps) {
  const id = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const toggle = (scanId: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(scanId)) next.delete(scanId);
      else next.add(scanId);
      return next;
    });
  };

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">펼치기</span>
            </TableHead>
            <TableHead>시작 시각</TableHead>
            <TableHead>종류</TableHead>
            <TableHead>상태</TableHead>
            <TableHead className="text-right">repo 수</TableHead>
            <TableHead className="text-right">신규</TableHead>
            <TableHead className="text-right">실패</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((scan) => {
            const running = scan.status === "running";
            const expandable = canExpand(scan);
            const isOpen = expandable && expanded.has(scan.id);
            const detailId = `${id}-scan-${scan.id}`;
            const count = (value: number) => (running ? "-" : value);
            return (
              <Fragment key={scan.id}>
                <TableRow data-state={isOpen ? "selected" : undefined}>
                  <TableCell>
                    {expandable && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="상세 보기"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? detailId : undefined}
                        onClick={() => toggle(scan.id)}
                      >
                        <ChevronRightIcon
                          aria-hidden="true"
                          className={cn("transition-transform", isOpen && "rotate-90")}
                        />
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatTableTime(scan.startedAt)}</TableCell>
                  <TableCell>{scanTriggerLabel(scan.trigger)}</TableCell>
                  <TableCell>
                    <StatusBadge status={scan.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count(scan.repoCount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(scan.newFindingCount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(scan.failedRepos.length)}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
                      <ScanDetail scan={scan} />
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

function ScanDetail({ scan }: { scan: Scan }) {
  return (
    <div className="flex flex-col gap-2 py-1 pl-10 text-sm">
      {scan.error !== null && (
        <p>
          <span className="font-medium">오류: </span>
          <span className="text-destructive">{scan.error}</span>
        </p>
      )}
      {scan.failedRepos.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">실패한 repo ({scan.failedRepos.length})</p>
          <ul className="flex flex-col gap-1">
            {scan.failedRepos.map((failed, index) => (
              <li key={`${failed.repo}-${index}`} className="flex flex-wrap gap-x-2">
                <span className="font-mono">{failed.repo}</span>
                <span className="text-muted-foreground">{failed.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
