// 이메일 수신자 chip 입력 (Phase 6.1 스텁 — Phase 6.2 에서 구현).
// chip 마다 제거 버튼(aria-label), 새 주소 입력 + [추가].

export interface RecipientsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** 필드 오류 연결용 (aria-describedby) */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function RecipientsInput(_props: RecipientsInputProps) {
  return null;
}
