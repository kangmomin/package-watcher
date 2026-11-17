// 대시보드 `/`.
// 구성: SummaryCards + 탭 3개("검출" 기본 / "위험한 설정" / "취약점") + 각 탭의 필터·표·Pager.
// 탭의 선택은 URL query(`?tab=policy`, `?tab=cve`)에 둔다. 탭마다 필터와 page 가 따로이고 탭을 바꿔도 유지된다(필터를 바꾸면 그 탭의 page 는 1).
// 초기 요청 = /api/findings?status=open&excludeCategory=policy&excludeSource=cve&page=1&limit=50. 필터 변경 → page=1.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DataState } from "@/components/DataState";
import { Pager } from "@/components/Pager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FindingsFilters } from "@/features/findings/FindingsFilters";
import { FindingsTable } from "@/features/findings/FindingsTable";
import { PolicyFindingsTable } from "@/features/findings/PolicyFindingsTable";
import { useFindings } from "@/features/findings/hooks";
import { SummaryCards } from "@/features/findings/SummaryCards";
import { useSummary } from "@/features/summary/useSummary";
import { VulnerabilitiesTab } from "@/features/vulnerabilities/VulnerabilitiesTab";
import type { FindingsFilter, VulnerabilitiesFilter } from "@/lib/api";
import { emptyPageFallback, firstLoadState, isUnconfirmedPage } from "@/lib/queryState";
import { cn } from "@/lib/utils";

type FindingsTabId = "findings" | "policy";
type TabId = FindingsTabId | "cve";

const TAB_PARAM = "tab";
const TAB_VALUES: readonly TabId[] = ["policy", "cve"];
const INITIAL_FILTER: FindingsFilter = { status: "open" };
// 탭이 요청에 항상 붙이는 분류 조건. 필터 state 에는 넣지 않는다.
// "검출" 탭은 위험한 설정과 취약점을 뺀다(각각 따로 센다).
const TAB_SCOPE: Record<FindingsTabId, FindingsFilter> = {
  findings: { excludeCategory: "policy", excludeSource: "cve" },
  policy: { category: "policy" },
};

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TAB_VALUES.find((value) => value === params.get(TAB_PARAM)) ?? "findings";
  const [filters, setFilters] = useState<Record<FindingsTabId, FindingsFilter>>({
    findings: INITIAL_FILTER,
    policy: INITIAL_FILTER,
  });
  const [pages, setPages] = useState<Record<FindingsTabId, number>>({ findings: 1, policy: 1 });
  const [cveFilter, setCveFilter] = useState<VulnerabilitiesFilter>({});
  const [cvePage, setCvePage] = useState(1);
  const summary = useSummary().data;

  // 탭마다 필터와 page 를 따로 유지한다. 핸들러는 참조를 고정한다 — FindingsFilters 의 debounce 타이머가 부모의 re-render 로 다시 시작되지 않게.
  const changeFilter = useCallback((kind: FindingsTabId, next: FindingsFilter) => {
    setFilters((prev) => ({ ...prev, [kind]: next }));
    setPages((prev) => ({ ...prev, [kind]: 1 }));
  }, []);
  const changePage = useCallback((kind: FindingsTabId, page: number) => setPages((prev) => ({ ...prev, [kind]: page })), []);
  const changeFindingsFilter = useCallback((next: FindingsFilter) => changeFilter("findings", next), [changeFilter]);
  const changePolicyFilter = useCallback((next: FindingsFilter) => changeFilter("policy", next), [changeFilter]);
  const changeFindingsPage = useCallback((page: number) => changePage("findings", page), [changePage]);
  const changePolicyPage = useCallback((page: number) => changePage("policy", page), [changePage]);
  const changeCveFilter = useCallback((next: VulnerabilitiesFilter) => {
    setCveFilter(next);
    setCvePage(1);
  }, []);

  const handleTabChange = (next: string) => {
    const nextParams = new URLSearchParams(params);
    const value = TAB_VALUES.find((candidate) => candidate === next);
    if (value !== undefined) nextParams.set(TAB_PARAM, value);
    else nextParams.delete(TAB_PARAM);
    setParams(nextParams);
  };
  const countLabel = (label: string, count: number | undefined) => (count === undefined ? label : `${label} (${count})`);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">대시보드</h1>
      <SummaryCards />
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList aria-label="검출 종류">
          <TabsTrigger value="findings">{countLabel("검출", summary?.openCount)}</TabsTrigger>
          <TabsTrigger value="policy">{countLabel("위험한 설정", summary?.policyOpenCount)}</TabsTrigger>
          <TabsTrigger value="cve">{countLabel("취약점", summary?.cveOpenCount)}</TabsTrigger>
        </TabsList>
        <TabsContent value="findings">
          <FindingsTab
            kind="findings"
            filter={filters.findings}
            page={pages.findings}
            onFilterChange={changeFindingsFilter}
            onPageChange={changeFindingsPage}
          />
        </TabsContent>
        <TabsContent value="policy">
          <FindingsTab
            kind="policy"
            filter={filters.policy}
            page={pages.policy}
            onFilterChange={changePolicyFilter}
            onPageChange={changePolicyPage}
          />
        </TabsContent>
        <TabsContent value="cve">
          <VulnerabilitiesTab filter={cveFilter} page={cvePage} onFilterChange={changeCveFilter} onPageChange={setCvePage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface FindingsTabProps {
  kind: FindingsTabId;
  filter: FindingsFilter;
  page: number;
  onFilterChange: (filter: FindingsFilter) => void;
  onPageChange: (page: number) => void;
}

function FindingsTab({ kind, filter, page, onFilterChange, onPageChange }: FindingsTabProps) {
  const findings = useFindings({ ...filter, ...TAB_SCOPE[kind] }, page);
  const data = findings.data;
  const isUnconfirmed = isUnconfirmedPage(findings);

  // 보던 페이지가 비었으면(검출이 줄어듦) 마지막 페이지로 옮긴다.
  const lastPage = emptyPageFallback(findings);
  useEffect(() => {
    if (lastPage !== undefined && page !== lastPage) onPageChange(lastPage);
  }, [lastPage, page, onPageChange]);

  return (
    <>
      <FindingsFilters filter={filter} onFilterChange={onFilterChange} variant={kind} />
      <DataState
        {...firstLoadState(findings)}
        isEmpty={data?.total === 0}
        emptyMessage={kind === "policy" ? "위험한 설정이 없습니다" : "검출이 없습니다"}
        onRetry={() => void findings.refetch()}
      >
        {data && (
          <div className="flex flex-col gap-3">
            <div
              aria-busy={isUnconfirmed || undefined}
              className={cn("transition-opacity", isUnconfirmed && "opacity-60")}
            >
              {kind === "policy" ? <PolicyFindingsTable items={data.items} /> : <FindingsTable items={data.items} />}
            </div>
            <Pager
              page={data.page}
              limit={data.limit}
              total={data.total}
              onPageChange={onPageChange}
              isDisabled={isUnconfirmed}
            />
          </div>
        )}
      </DataState>
    </>
  );
}
