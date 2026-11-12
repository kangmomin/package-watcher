// GET 첫 로드 실패 표현 (UI State Contract): "데이터를 불러오지 못했습니다" + [다시 시도].
import { Button } from "@/components/ui/button";

export interface LoadErrorProps {
  onRetry: () => void;
}

const LOAD_ERROR_MESSAGE = "데이터를 불러오지 못했습니다";

export function LoadError({ onRetry }: LoadErrorProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border px-4 py-10 text-center text-sm">
      <p className="text-muted-foreground">{LOAD_ERROR_MESSAGE}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
