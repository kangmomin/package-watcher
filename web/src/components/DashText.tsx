// 값이 없는 칸의 `—`. 시각적으로는 대시이고, 스크린 리더에는 srText 를 읽힌다.
import { NOT_APPLICABLE_LABEL } from "@/lib/format";

export function DashText({ srText }: { srText: string }) {
  return (
    <>
      <span aria-hidden="true">{NOT_APPLICABLE_LABEL}</span>
      <span className="sr-only">{srText}</span>
    </>
  );
}
