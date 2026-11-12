// loading 표현: Skeleton 을 감싸고 스크린 리더에 "불러오는 중" 을 알린다(role="status").
// Skeleton 은 내용 없는 장식이라 스크린 리더에는 status 문구만 남는다.
import type { ReactNode } from "react";

export interface LoadingStateProps {
  className?: string;
  children: ReactNode;
}

export function LoadingState({ className, children }: LoadingStateProps) {
  return (
    <div className={className}>
      {children}
      <span role="status" className="sr-only">
        불러오는 중
      </span>
    </div>
  );
}
