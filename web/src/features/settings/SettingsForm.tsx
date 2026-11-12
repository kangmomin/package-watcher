// 설정 폼 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// 필드: org(null → 빈 입력, 안내 "org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다"), interval(시간),
// 요약 시각 + "Asia/Seoul", 수신자 chip. 제출 전 shared 스키마로 검증.
// 폼 reset 은 첫 로드와 저장 성공(응답 값) 때만. 저장 중 [저장] 비활성.
// [테스트 메일] 비활성: 서버 recipients 0명, smtpConfigured=false, 폼 dirty("저장 후 테스트할 수 있습니다"), 요청 중.
import type { Settings } from "@pw/shared";

export interface SettingsFormProps {
  settings: Settings;
}

export function SettingsForm(_props: SettingsFormProps) {
  return null;
}
