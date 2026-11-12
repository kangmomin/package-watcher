// 대시보드 필터.
// 상태 select = open(기본)/ignored/resolved/전체(파라미터 생략). repo·패키지 입력 = trim + 300ms debounce, 비면 생략.
import { SEVERITIES, SUPPORTED_ECOSYSTEMS, type FindingStatus } from "@pw/shared";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FindingsFilter } from "@/lib/api";

export interface FindingsFiltersProps {
  filter: FindingsFilter;
  onFilterChange: (filter: FindingsFilter) => void;
}

interface FilterSelectProps<T extends string> {
  id: string;
  label: string;
  /** undefined = 전체 */
  value: T | undefined;
  options: readonly T[];
  onChange: (value: T | undefined) => void;
}

const FILTER_DEBOUNCE_MS = 300;
// Radix Select 는 빈 문자열 값을 쓸 수 없다. "전체" = 그 필터 파라미터 생략.
const ALL_OPTION = "all";
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

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterSelect
        id={`${id}-status`}
        label="상태"
        value={filter.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onFilterChange({ ...filter, status })}
      />
      <FilterSelect
        id={`${id}-ecosystem`}
        label="종류"
        value={filter.ecosystem}
        options={SUPPORTED_ECOSYSTEMS}
        onChange={(ecosystem) => onFilterChange({ ...filter, ecosystem })}
      />
      <FilterSelect
        id={`${id}-severity`}
        label="심각도"
        value={filter.severity}
        options={SEVERITIES}
        onChange={(severity) => onFilterChange({ ...filter, severity })}
      />
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

function FilterSelect<T extends string>({ id, label, value, options, onChange }: FilterSelectProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* 선택한 값을 options 에서 찾는다: "전체"는 목록에 없으므로 undefined 가 된다. */}
      <Select value={value ?? ALL_OPTION} onValueChange={(next) => onChange(options.find((option) => option === next))}>
        <SelectTrigger id={id} className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={ALL_OPTION}>전체</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
