// 블랙리스트 필터 줄: 종류 select, 상태 select, 이름 검색.
// "전체" = 그 필터 파라미터 생략. 이름 입력 = trim + 300ms debounce, 비면 생략.
import { ENTRY_STATUSES, SUPPORTED_ECOSYSTEMS, type EntryStatus } from "@pw/shared";
import { useEffect, useId, useState } from "react";
import { EcosystemSelectItems } from "@/components/EcosystemSelectItems";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlacklistFilter } from "@/lib/api";
import { entryStatusLabel } from "@/lib/format";

export interface BlacklistFiltersProps {
  filter: BlacklistFilter;
  onFilterChange: (filter: BlacklistFilter) => void;
}

const FILTER_DEBOUNCE_MS = 300;
// Radix Select 는 빈 문자열 값을 쓸 수 없다.
const ALL_OPTION = "all";

export function BlacklistFilters({ filter, onFilterChange }: BlacklistFiltersProps) {
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
            onFilterChange({
              ...filter,
              ecosystem: SUPPORTED_ECOSYSTEMS.find((option) => option === next),
            })
          }
        >
          <SelectTrigger id={`${id}-ecosystem`} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_OPTION}>전체</SelectItem>
            <EcosystemSelectItems />
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-status`}>상태</Label>
        <Select
          value={filter.status ?? ALL_OPTION}
          onValueChange={(next) =>
            onFilterChange({
              ...filter,
              status: ENTRY_STATUSES.find((option: EntryStatus) => option === next),
            })
          }
        >
          <SelectTrigger id={`${id}-status`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTRY_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {entryStatusLabel(option)}
              </SelectItem>
            ))}
            <SelectItem value={ALL_OPTION}>전체</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-q`}>이름</Label>
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
  );
}
