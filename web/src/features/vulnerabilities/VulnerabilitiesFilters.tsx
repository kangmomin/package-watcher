// "취약점" 탭의 필터: 종류(패키지 분류만), 이름 검색(300ms debounce), "직접 의존성만" 스위치.
import { SUPPORTED_ECOSYSTEMS } from "@pw/shared";
import { useEffect, useId, useState } from "react";
import { EcosystemSelectItems } from "@/components/EcosystemSelectItems";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { VulnerabilitiesFilter } from "@/lib/api";

export interface VulnerabilitiesFiltersProps {
  filter: VulnerabilitiesFilter;
  onFilterChange: (filter: VulnerabilitiesFilter) => void;
}

const FILTER_DEBOUNCE_MS = 300;
// Radix Select 는 빈 문자열 값을 쓸 수 없다. "전체" = 그 필터 파라미터 생략.
const ALL_OPTION = "all";

export function VulnerabilitiesFilters({ filter, onFilterChange }: VulnerabilitiesFiltersProps) {
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
            <EcosystemSelectItems includePolicy={false} categories={["package"]} />
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-q`}>패키지</Label>
        <Input
          id={`${id}-q`}
          type="text"
          placeholder="검색"
          className="w-48"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <div className="flex h-8 items-center gap-2">
        <Switch
          id={`${id}-direct`}
          checked={filter.directOnly === true}
          onCheckedChange={(checked) => onFilterChange({ ...filter, directOnly: checked ? true : undefined })}
        />
        <Label htmlFor={`${id}-direct`}>직접 의존성만</Label>
      </div>
    </div>
  );
}
