// 대시보드 필터.
// 상태 select = open(기본)/ignored/resolved/전체(파라미터 생략). repo·패키지 입력 = trim + 300ms debounce, 비면 생략.
import { SEVERITIES, SUPPORTED_ECOSYSTEMS, type Ecosystem, type FindingStatus, type Severity } from "@pw/shared";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FindingsFilter } from "@/lib/api";

export interface FindingsFiltersProps {
  filter: FindingsFilter;
  onFilterChange: (filter: FindingsFilter) => void;
}

const FILTER_DEBOUNCE_MS = 300;
// Radix Select 는 빈 문자열 값을 쓸 수 없다. "전체" = 그 필터 파라미터 생략.
const ALL_STATUSES = "all";
const STATUS_OPTIONS: readonly FindingStatus[] = ["open", "ignored", "resolved"];

function toTextFilter(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function FindingsFilters({ filter, onFilterChange }: FindingsFiltersProps) {
  const id = useId();
  const [repoDraft, setRepoDraft] = useState(filter.repo ?? "");
  const [packageDraft, setPackageDraft] = useState(filter.package ?? "");

  // 입력이 멈추고 300ms 뒤에 1번만 반영한다. trim 한 값이 같으면 요청하지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => {
      const repo = toTextFilter(repoDraft);
      const pkg = toTextFilter(packageDraft);
      if (repo !== filter.repo || pkg !== filter.package) {
        onFilterChange({ ...filter, repo, package: pkg });
      }
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [repoDraft, packageDraft, filter, onFilterChange]);

  const handleStatusChange = (value: string) => {
    const status = value === ALL_STATUSES ? undefined : (value as FindingStatus);
    onFilterChange({ ...filter, status });
  };

  const handleEcosystemChange = (value: string) => {
    const ecosystem = value === ALL_STATUSES ? undefined : (value as Ecosystem);
    onFilterChange({ ...filter, ecosystem });
  };

  const handleSeverityChange = (value: string) => {
    const severity = value === ALL_STATUSES ? undefined : (value as Severity);
    onFilterChange({ ...filter, severity });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-status`}>상태</Label>
        <Select value={filter.status ?? ALL_STATUSES} onValueChange={handleStatusChange}>
          <SelectTrigger id={`${id}-status`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
            <SelectItem value={ALL_STATUSES}>전체</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-ecosystem`}>종류</Label>
        <Select value={filter.ecosystem ?? ALL_STATUSES} onValueChange={handleEcosystemChange}>
          <SelectTrigger id={`${id}-ecosystem`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_ECOSYSTEMS.map((ecosystem) => (
              <SelectItem key={ecosystem} value={ecosystem}>
                {ecosystem}
              </SelectItem>
            ))}
            <SelectItem value={ALL_STATUSES}>전체</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-severity`}>심각도</Label>
        <Select value={filter.severity ?? ALL_STATUSES} onValueChange={handleSeverityChange}>
          <SelectTrigger id={`${id}-severity`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {severity}
              </SelectItem>
            ))}
            <SelectItem value={ALL_STATUSES}>전체</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-repo`}>repo</Label>
        <Input
          id={`${id}-repo`}
          type="text"
          placeholder="검색"
          className="w-48"
          value={repoDraft}
          onChange={(event) => setRepoDraft(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-package`}>패키지</Label>
        <Input
          id={`${id}-package`}
          type="text"
          placeholder="검색"
          className="w-48"
          value={packageDraft}
          onChange={(event) => setPackageDraft(event.target.value)}
        />
      </div>
    </div>
  );
}
