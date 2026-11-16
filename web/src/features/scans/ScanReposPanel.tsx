// 펼친 스캔의 "repo별 진행 상황": 상태 필터 + repo 검색(300ms debounce) + 표 + 페이저(50건).
// 펼친 행만 조회한다: 이 컴포넌트가 마운트될 때만 GET /api/scans/:id/repos 를 호출한다.
import { SCAN_REPO_STATUSES, type ScanRepo, type ScanRepoStatus } from "@pw/shared";
import { useCallback, useEffect, useId, useState } from "react";
import { DataState } from "@/components/DataState";
import { Pager } from "@/components/Pager";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { ScanRepoStatusBadge } from "@/components/ScanRepoStatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useScanRepos } from "@/features/scans/hooks";
import type { ScanReposFilter } from "@/lib/api";
import { scanRepoStatusLabel } from "@/lib/format";
import { emptyPageFallback, firstLoadState, isUnconfirmedPage } from "@/lib/queryState";
import { cn } from "@/lib/utils";

export interface ScanReposPanelProps {
  scanId: number;
  /** 스캔이 running 이면 5초마다 다시 조회한다 */
  running: boolean;
  /** 그 스캔의 대상 repo 수 (`repoStats.total`) */
  total: number;
  /** 어느 스캔의 표인지 알리는 요소(시작 시각 셀)의 id */
  describedBy?: string;
}

const SEARCH_DEBOUNCE_MS = 300;
// Radix Select 는 빈 문자열 값을 쓸 수 없다. "전체" = status 파라미터 생략.
const ALL_OPTION = "all";
const TITLE = "repo별 진행 상황";
// 끝나지 않았거나(대기·진행 중) 실패한 repo 의 수는 의미가 없어서 "-" 로 표시한다.
const NO_COUNT_STATUSES: readonly ScanRepoStatus[] = ["pending", "running", "failed"];

function toTextFilter(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function ScanReposPanel({ scanId, running, total, describedBy }: ScanReposPanelProps) {
  const id = useId();
  const [filter, setFilter] = useState<ScanReposFilter>({});
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const repos = useScanRepos(scanId, filter, page, running);
  const data = repos.data;
  const isUnconfirmed = isUnconfirmedPage(repos);
  const filtered = filter.status !== undefined || filter.q !== undefined;

  const changeFilter = useCallback((next: ScanReposFilter) => {
    setFilter(next);
    setPage(1);
  }, []);

  // 입력이 멈추고 300ms 뒤에 1번만 반영한다. trim 한 값이 같으면 요청하지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = toTextFilter(draft);
      if (q !== filter.q) changeFilter({ ...filter, q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, filter, changeFilter]);

  // 보던 페이지가 비었으면 마지막 페이지로 옮긴다.
  const lastPage = emptyPageFallback(repos);
  if (lastPage !== undefined && page !== lastPage) setPage(lastPage);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{TITLE}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-status`}>상태</Label>
          <Select
            value={filter.status ?? ALL_OPTION}
            onValueChange={(next) =>
              changeFilter({
                ...filter,
                status: SCAN_REPO_STATUSES.find((status) => status === next),
              })
            }
          >
            <SelectTrigger id={`${id}-status`} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>전체</SelectItem>
              {SCAN_REPO_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {scanRepoStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-q`}>repo</Label>
          <Input
            id={`${id}-q`}
            type="text"
            placeholder="검색"
            className="w-48"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </div>
      <DataState
        {...firstLoadState(repos)}
        isEmpty={data?.total === 0}
        emptyMessage={
          filtered
            ? "조건에 맞는 repo가 없습니다"
            : // 집계에는 repo 가 있는데 행이 없으면 보관 기간이 지난 것이다.
              total === 0
              ? "검사 대상 repo가 없습니다"
              : "repo별 기록은 최근 30회의 스캔만 보관합니다"
        }
        onRetry={() => void repos.refetch()}
      >
        {data && (
          <div className="flex flex-col gap-3">
            <div
              aria-busy={isUnconfirmed || undefined}
              className={cn("transition-opacity", isUnconfirmed && "opacity-60")}
            >
              <ScanReposTable items={data.items} describedBy={describedBy} />
            </div>
            <Pager
              page={data.page}
              limit={data.limit}
              total={data.total}
              onPageChange={setPage}
              isDisabled={isUnconfirmed}
            />
          </div>
        )}
      </DataState>
    </div>
  );
}

function ScanReposTable({ items, describedBy }: { items: ScanRepo[]; describedBy?: string }) {
  return (
    <div className="rounded-lg border bg-background">
      <Table aria-label={TITLE} aria-describedby={describedBy}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">repo</TableHead>
            <TableHead scope="col">상태</TableHead>
            <TableHead scope="col" className="text-right">
              검출
            </TableHead>
            <TableHead scope="col" className="text-right">
              신규
            </TableHead>
            <TableHead scope="col" className="text-right">
              파일
            </TableHead>
            <TableHead scope="col">내용</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const count = (value: number) =>
              NO_COUNT_STATUSES.includes(item.status) ? "-" : value;
            return (
              <TableRow key={item.repo}>
                <RowHeaderCell className="font-mono">{item.repo}</RowHeaderCell>
                <TableCell>
                  <ScanRepoStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count(item.openFindingCount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count(item.newFindingCount)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count(item.fileCount)}
                  {item.branchCount > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">{`브랜치 ${item.branchCount}개`}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {item.error}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
