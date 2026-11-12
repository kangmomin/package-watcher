// loading 표현: Skeleton 을 감싸고 스크린 리더에 "불러오는 중" 을 알린다.
import type { ReactNode } from "react";

export interface LoadingStateProps {
  className?: string;
  children: ReactNode;
}

export function LoadingState({ className, children }: LoadingStateProps) {
  return (
    <div aria-busy="true" className={className}>
      {children}
      <span className="sr-only">불러오는 중</span>
    </div>
  );
}
