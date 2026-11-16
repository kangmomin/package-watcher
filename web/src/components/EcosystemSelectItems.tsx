// 종류 select 의 옵션: 분류(패키지 / CI·이미지)별 그룹. 순서는 shared 의 ECOSYSTEMS 순서를 따른다.
import { ECOSYSTEM_CATEGORIES, ECOSYSTEMS, categoryOf } from "@pw/shared";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { ecosystemCategoryLabel, ecosystemLabel } from "@/lib/format";

export function EcosystemSelectItems() {
  return (
    <>
      {ECOSYSTEM_CATEGORIES.map((category) => (
        <SelectGroup key={category}>
          <SelectLabel>{ecosystemCategoryLabel(category)}</SelectLabel>
          {ECOSYSTEMS.filter((ecosystem) => categoryOf(ecosystem) === category).map((ecosystem) => (
            <SelectItem key={ecosystem} value={ecosystem}>
              {ecosystemLabel(ecosystem)}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
