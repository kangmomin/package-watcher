// 외부 목록 검색 `/feed`. 상단 메뉴에는 없고 설정 화면의 "목록 검색" 링크로만 온다.
// 검색어(이름 또는 GHSA-…) 300ms debounce + 분류 select(전체/악성 패키지/취약점) + 종류 select(패키지·CI) + 표 + 쪽 나눔.
// empty = 필터가 없으면 "아직 가져온 항목이 없습니다", 있으면 "조건에 맞는 항목이 없습니다".
import { FEED_KINDS, SUPPORTED_ECOSYSTEMS, type FeedEntry } from "@pw/shared";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { DataState } from "@/components/DataState";
import { EcosystemSelectItems } from "@/components/EcosystemSelectItems";
import { Pager } from "@/components/Pager";
import { RowHeaderCell } from "@/components/RowHeaderCell";
import { SeverityBadge } from "@/components/SeverityBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFeedEntries } from "@/features/feed/hooks";
import type { FeedEntriesFilter } from "@/lib/api";
import {
  NOT_APPLICABLE_LABEL,
  ecosystemLabel,
  feedKindLabel,
  formatCardTime,
  formatCvssScore,
  isHttpUrl,
} from "@/lib/format";
import { emptyPageFallback, firstLoadState, isUnconfirmedPage } from "@/lib/queryState";
import { cn } from "@/lib/utils";

const FILTER_DEBOUNCE_MS = 300;
// Radix Select 는 빈 문자열 값을 쓸 수 없다.
const ALL_OPTION = "all";

export function FeedPage() {
  const [filter, setFilter] = useState<FeedEntriesFilter>({});
  const [page, setPage] = useState(1);
  const entries = useFeedEntries(filter, page);
  const data = entries.data;
  const isUnconfirmed = isUnconfirmedPage(entries);
  const hasFilter = filter.q !== undefined || filter.ecosystem !== undefined || filter.kind !== undefined;

  // 필터를 바꾸면 1쪽으로 돌아간다. 참조를 고정해서 debounce 타이머가 re-render 로 다시 시작되지 않게 한다.
  const changeFilter = useCallback((next: FeedEntriesFilter) => {
    setFilter(next);
    setPage(1);
  }, []);

  // 보던 쪽이 비었으면(항목이 줄어듦) 마지막 쪽으로 옮긴다. 렌더 중에 맞추면 빈 쪽이 한 번도 그려지지 않는다.
  const lastPage = emptyPageFallback(entries);
  if (lastPage !== undefined && page !== lastPage) setPage(lastPage);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link to="/settings" className="inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4">
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          설정으로
        </Link>
        <h1 className="text-xl font-semibold">외부 목록 검색</h1>
      </div>
      <FeedFilters filter={filter} onFilterChange={changeFilter} />
      <DataState
        {...firstLoadState(entries)}
        isEmpty={data?.total === 0}
        emptyMessage={hasFilter ? "조건에 맞는 항목이 없습니다" : "아직 가져온 항목이 없습니다"}
        onRetry={() => void entries.refetch()}
      >
        {data && (
          <div className="flex flex-col gap-3">
            <div aria-busy={isUnconfirmed || undefined} className={cn("transition-opacity", isUnconfirmed && "opacity-60")}>
              <FeedTable items={data.items} showCve={filter.kind === "cve" || data.items.some((entry) => entry.kind === "cve")} />
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} isDisabled={isUnconfirmed} />
          </div>
        )}
      </DataState>
    </div>
  );
}

interface FeedFiltersProps {
  filter: FeedEntriesFilter;
  onFilterChange: (filter: FeedEntriesFilter) => void;
}

function FeedFilters({ filter, onFilterChange }: FeedFiltersProps) {
  const id = useId();
  const [draft, setDraft] = useState(filter.q ?? "");

  // 입력이 멈추고 300ms 뒤에 1번만 반영한다. trim 한 값이 같으면 요청하지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = draft.trim() === "" ? undefined : draft.trim();
      if (q !== filter.q) onFilterChange({ ...filter, q });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, filter, onFilterChange]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-q`}>검색어</Label>
        <Input
          id={`${id}-q`}
          type="text"
          placeholder="이름 또는 GHSA-…"
          className="w-64"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-kind`}>분류</Label>
        <Select
          value={filter.kind ?? ALL_OPTION}
          onValueChange={(next) => onFilterChange({ ...filter, kind: FEED_KINDS.find((option) => option === next) })}
        >
          <SelectTrigger id={`${id}-kind`} className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>전체</SelectItem>
            {FEED_KINDS.map((option) => (
              <SelectItem key={option} value={option}>
                {feedKindLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-ecosystem`}>종류</Label>
        <Select
          value={filter.ecosystem ?? ALL_OPTION}
          onValueChange={(next) =>
            onFilterChange({ ...filter, ecosystem: SUPPORTED_ECOSYSTEMS.find((option) => option === next) })
          }
        >
          <SelectTrigger id={`${id}-ecosystem`} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>전체</SelectItem>
            <EcosystemSelectItems includePolicy={false} categories={["package", "ci"]} />
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// 취약점(cve) 항목이 보일 때만 분류·점수·고쳐진 버전 열을 더한다(악성 패키지만 보일 때는 점수와 고쳐진 버전이 없다).
function FeedTable({ items, showCve }: { items: FeedEntry[]; showCve: boolean }) {
  return (
    <div className="rounded-lg border">
      <Table aria-label="외부 목록">
        <TableHeader>
          <TableRow>
            {showCve && <TableHead scope="col">분류</TableHead>}
            <TableHead scope="col">종류</TableHead>
            <TableHead scope="col">이름</TableHead>
            <TableHead scope="col">범위</TableHead>
            <TableHead scope="col">심각도</TableHead>
            {showCve && <TableHead scope="col">점수</TableHead>}
            {showCve && <TableHead scope="col">고쳐진 버전</TableHead>}
            <TableHead scope="col">요약</TableHead>
            <TableHead scope="col">갱신 시각</TableHead>
            <TableHead scope="col">권고</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry) => (
            <TableRow key={`${entry.externalId}:${entry.ecosystem}:${entry.name}:${entry.rawRange}`}>
              {showCve && <TableCell>{feedKindLabel(entry.kind)}</TableCell>}
              <TableCell>{ecosystemLabel(entry.ecosystem)}</TableCell>
              <RowHeaderCell className="max-w-64 truncate font-mono text-xs font-medium" title={entry.name}>
                {entry.name}
              </RowHeaderCell>
              <TableCell className="font-mono text-xs" title={entry.rawRange === "" ? undefined : `원문: ${entry.rawRange}`}>
                {entry.versionRange ?? <span className="font-sans text-muted-foreground">모든 버전</span>}
              </TableCell>
              <TableCell>
                <SeverityBadge severity={entry.severity} />
              </TableCell>
              {showCve && <TableCell className="tabular-nums">{formatCvssScore(entry.cvssScore)}</TableCell>}
              {showCve && (
                <TableCell className="font-mono text-xs">{entry.patchedVersion ?? NOT_APPLICABLE_LABEL}</TableCell>
              )}
              <TableCell className="max-w-96 whitespace-normal [overflow-wrap:anywhere]">{entry.summary}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatCardTime(entry.updatedAt)}</TableCell>
              <TableCell>
                {isHttpUrl(entry.url) ? (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${entry.externalId} 권고 (새 창)`}
                    className="inline-flex items-center gap-1 font-mono text-xs underline underline-offset-4"
                  >
                    {entry.externalId}
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-mono text-xs">{entry.externalId}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
