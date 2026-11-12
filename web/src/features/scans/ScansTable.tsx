// 스캔 이력 표.
// 열: 시작 시각, 종류(자동/수동), 상태, 진행, 통과, 이슈, 실패, 건너뜀, 신규.
// repoStats 가 있으면 진행 = `끝난 수 / total` 이고 통과·이슈·실패·건너뜀은 repoStats 값이다.
// repoStats 가 null 이면(이 기능 이전의 스캔) v1 표시: 진행 = repoCount, 통과·이슈·건너뜀 = "-", 실패 = failedRepos.length.
// running 행의 신규는 "-" 이고, repoStats 가 null 인 running 행은 진행·실패도 "-".
// 행 펼침 = repoStats 가 있거나, 목록 데이터의 error(null 아니면) + failedRepos 가 있을 때.
// 펼칠 수 있는 행은 행을 클릭해도 펼친다(S-19). `상세 보기` 버튼은 키보드 조작용이다.
// 접근성: 시작 시각 셀이 행 헤더다. `상세 보기` 버튼은 이름을 바꾸지 않고 시작 시각 셀을 설명으로 연결한다.
import type { Scan, ScanRepoStats } from "@pw/shared";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useId, useState } from "react";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ScanReposPanel } from "@/features/scans/ScanReposPanel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatTableTime, scanTriggerLabel } from "@/lib/format";

export interface ScansTableProps {
  items: Scan[];
}

interface ScanDetailProps {
  scan: Scan;
  startedAtId: string;
}

const COLUMN_COUNT = 10;

function canExpand(scan: Scan): boolean {
  return scan.repoStats !== null || scan.error !== null || scan.failedRepos.length > 0;
}

/** 끝난 repo 수 = total − 대기 − 진행 중 (= 통과 + 이슈 + 실패 + 건너뜀) */
function finishedCount(stats: ScanRepoStats): number {
  return stats.total - stats.pending - stats.running;
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
      <Table aria-label="스캔 이력">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-10">
              <span className="sr-only">펼치기</span>
            </TableHead>
            <TableHead scope="col">시작 시각</TableHead>
            <TableHead scope="col">종류</TableHead>
            <TableHead scope="col">상태</TableHead>
            <TableHead scope="col" className="text-right">
              진행
            </TableHead>
            <TableHead scope="col" className="text-right">
              통과
            </TableHead>
            <TableHead scope="col" className="text-right">
              이슈
            </TableHead>
            <TableHead scope="col" className="text-right">
              실패
            </TableHead>
            <TableHead scope="col" className="text-right">
              건너뜀
            </TableHead>
            <TableHead scope="col" className="text-right">
              신규
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((scan) => {
            const running = scan.status === "running";
            const expandable = canExpand(scan);
            const isOpen = expandable && expanded.has(scan.id);
            const detailId = `${id}-scan-${scan.id}`;
            const startedAtId = `${id}-scan-${scan.id}-started`;
            const stats = scan.repoStats;
            const count = (value: number) => (running ? "-" : value);
            const statCount = (pick: (value: ScanRepoStats) => number) => (stats ? pick(stats) : "-");
            return (
              <Fragment key={scan.id}>
                <TableRow
                  data-state={isOpen ? "selected" : undefined}
                  className={cn(expandable && "cursor-pointer")}
                  onClick={expandable ? () => toggle(scan.id) : undefined}
                >
                  <TableCell>
                    {expandable && (
                      // onClick 을 두지 않는다: 버튼 클릭(Enter·Space 포함)은 행으로 전파되어 행의 onClick 이
                      // 한 번만 토글한다. 버튼은 키보드·스크린 리더 사용자를 위한 조작 지점이다.
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="상세 보기"
                        aria-describedby={startedAtId}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? detailId : undefined}
                      >
                        <ChevronRightIcon
                          aria-hidden="true"
                          className={cn("transition-transform", isOpen && "rotate-90")}
                        />
                      </Button>
                    )}
                  </TableCell>
                  <RowHeaderCell id={startedAtId} className="tabular-nums">
                    {formatTableTime(scan.startedAt)}
                  </RowHeaderCell>
                  <TableCell>{scanTriggerLabel(scan.trigger)}</TableCell>
                  <TableCell>
                    <StatusBadge status={scan.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stats ? `${finishedCount(stats)} / ${stats.total}` : count(scan.repoCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{statCount((value) => value.passed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{statCount((value) => value.issue)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stats ? stats.failed : count(scan.failedRepos.length)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{statCount((value) => value.skipped)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(scan.newFindingCount)}</TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
                      <ScanDetail scan={scan} startedAtId={startedAtId} />
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

function summarySentence(scan: Scan, stats: ScanRepoStats): string {
  const base = `${stats.total}건 중 통과 ${stats.passed}건 · 이슈 ${stats.issue}건 · 실패 ${stats.failed}건 · 건너뜀 ${stats.skipped}건`;
  return scan.status === "running" ? `${base} · 대기 ${stats.pending}건 · 진행 중 ${stats.running}건` : base;
}

function ScanDetail({ scan, startedAtId }: ScanDetailProps) {
  return (
    <div className="flex flex-col gap-3 py-1 pl-10 text-sm">
      {scan.repoStats !== null && <p>{summarySentence(scan, scan.repoStats)}</p>}
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
      {scan.repoStats !== null && (
        <ScanReposPanel
          scanId={scan.id}
          running={scan.status === "running"}
          total={scan.repoStats.total}
          describedBy={startedAtId}
        />
      )}
    </div>
  );
}
