// 설정 hooks.
// 계약: 저장 성공 → settings·summary·findings 무효화(INTERNAL_ERROR·NETWORK_ERROR·parse 실패도 같다).
// 테스트 메일은 본문 없이 POST /api/settings/test-email (저장된 수신자에게 보낸다).
import type { Settings, SettingsInput, TestEmailResult } from "@pw/shared";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ApiRequestError } from "@/lib/api";
import { errorToastMessage, invalidateKeys, isUnknownOutcome } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

export function useSettings(): UseQueryResult<Settings, ApiRequestError> {
  return useQuery<Settings, ApiRequestError>({
    queryKey: queryKeys.settings(),
    queryFn: api.getSettings,
  });
}

// feedEnabled 가 바뀌면 feed 상태의 enabled 도 바뀐다.
const SAVE_KEYS = [queryKeys.settings(), queryKeys.summary(), queryKeys.findingsAll(), queryKeys.feedStatus()];

/** toast·필드 오류·폼 reset 은 화면이 한다(오류 코드별로 필드 오류와 toast 를 나눠야 한다). */
export function useSaveSettings(): UseMutationResult<Settings, ApiRequestError, SettingsInput> {
  const queryClient = useQueryClient();
  return useMutation<Settings, ApiRequestError, SettingsInput>({
    mutationFn: api.saveSettings,
    onSuccess: () => void invalidateKeys(queryClient, SAVE_KEYS),
    onError: (error) => {
      if (isUnknownOutcome(error)) void invalidateKeys(queryClient, SAVE_KEYS);
    },
  });
}

export function useTestEmail(): UseMutationResult<TestEmailResult, ApiRequestError, void> {
  return useMutation<TestEmailResult, ApiRequestError, void>({
    mutationFn: () => api.sendTestEmail(),
    onSuccess: () => {
      toast.success("테스트 메일을 보냈습니다");
    },
    onError: (error) => {
      toast.error(errorToastMessage(error));
    },
  });
}
