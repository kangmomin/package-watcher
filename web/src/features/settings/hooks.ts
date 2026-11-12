// 설정 hooks (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 계약: 저장 성공 → settings·summary·findings 무효화(INTERNAL_ERROR·NETWORK_ERROR·parse 실패도 같다).
// 테스트 메일은 본문 없이 POST /api/settings/test-email (저장된 수신자에게 보낸다).
import type { Settings, SettingsInput, TestEmailResult } from "@pw/shared";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { ApiRequestError } from "@/lib/api";

export function useSettings(): UseQueryResult<Settings, ApiRequestError> {
  throw new Error("not implemented");
}

export function useSaveSettings(): UseMutationResult<Settings, ApiRequestError, SettingsInput> {
  throw new Error("not implemented");
}

export function useTestEmail(): UseMutationResult<TestEmailResult, ApiRequestError, void> {
  throw new Error("not implemented");
}
