// 연결 상태 (읽기 전용) (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// GitHub 토큰 = env / gh CLI / 없음, SMTP = 설정됨 / 없음.
import type { Settings } from "@pw/shared";

export interface ConnectionStatusProps {
  githubTokenSource: Settings["githubTokenSource"];
  smtpConfigured: boolean;
}

export function ConnectionStatus(_props: ConnectionStatusProps) {
  return null;
}
