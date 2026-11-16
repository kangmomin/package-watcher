// 종류 select 의 옵션: 분류별 그룹. 순서는 shared 의 ECOSYSTEMS 순서를 따른다.
import {
  ECOSYSTEM_CATEGORIES,
  ECOSYSTEMS,
  categoryOf,
  isUserManagedEcosystem,
  type EcosystemCategory,
} from "@pw/shared";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { ecosystemCategoryLabel, ecosystemLabel } from "@/lib/format";

export interface EcosystemSelectItemsProps {
  /** false = 위험한 설정(policy) 그룹을 뺀다. 등록 Dialog 와 검출 탭이 쓴다(항목을 만들 수 없거나 따로 보는 종류) */
  includePolicy?: boolean;
  /** 지정하면 이 분류의 종류만 보인다 (외부 목록은 패키지·CI 만 다룬다) */
  categories?: readonly EcosystemCategory[];
}

export function EcosystemSelectItems({ includePolicy = true, categories }: EcosystemSelectItemsProps = {}) {
  const included = includePolicy ? ECOSYSTEMS : ECOSYSTEMS.filter(isUserManagedEcosystem);
  const ecosystems = categories ? included.filter((e) => categories.includes(categoryOf(e))) : included;
  return (
    <>
      {ECOSYSTEM_CATEGORIES.filter((category) => ecosystems.some((e) => categoryOf(e) === category)).map((category) => (
        <SelectGroup key={category}>
          <SelectLabel>{ecosystemCategoryLabel(category)}</SelectLabel>
          {ecosystems.filter((ecosystem) => categoryOf(ecosystem) === category).map((ecosystem) => (
            <SelectItem key={ecosystem} value={ecosystem}>
              {ecosystemLabel(ecosystem)}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
