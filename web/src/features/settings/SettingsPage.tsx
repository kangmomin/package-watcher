// 설정 `/settings`.
// loading = 폼 Skeleton. 오류 = 폼 자리에 오류 문장 + [다시 시도], [저장]·[테스트 메일] 숨김.
import { LoadError } from "@/components/DataState";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings } from "@/features/settings/hooks";
import { SettingsForm } from "@/features/settings/SettingsForm";

export function SettingsPage() {
  const settings = useSettings();
  const data = settings.data;
  const isLoadError = data === undefined && settings.isError && !settings.isFetching;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">설정</h1>
      {data !== undefined ? (
        // 폼 reset 은 첫 로드와 저장 성공 때만 한다: 재조회로 data 가 바뀌어도 SettingsForm 을 다시 만들지 않는다.
        <SettingsForm settings={data} />
      ) : isLoadError ? (
        <LoadError onRetry={() => void settings.refetch()} />
      ) : (
        <FormSkeleton />
      )}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex max-w-3xl flex-col gap-5">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-[11rem_1fr]">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-full max-w-72" />
        </div>
      ))}
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
