// 이메일 수신자 chip 입력.
// chip 마다 제거 버튼(aria-label), 새 주소 입력 + [추가].
// 형식 검증은 [추가] 를 누를 때 한다(S-12). 잘못된 값은 chip 으로 넣지 않고 입력 아래에 오류를 표시한다.
import { recipientsSchema } from "@pw/shared";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface RecipientsInputProps {
  /** 새 주소 입력의 id. 바깥 label 의 htmlFor 와 맞춘다. 생략하면 자체 id 를 쓴다 */
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  /** 필드 오류 연결용 (aria-describedby) */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** 저장 스키마와 같은 규칙·문구로 주소 1개를 검증한다. */
function validateRecipient(address: string): string | undefined {
  const result = recipientsSchema.safeParse([address]);
  return result.success ? undefined : result.error.issues[0]?.message;
}

export function RecipientsInput({
  id,
  value,
  onChange,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: RecipientsInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  // 폼 수준 recipients 오류(aria-describedby 로 받는다)와 id 가 겹치지 않게 따로 짓는다.
  const draftErrorId = `${inputId}-draft-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | undefined>();

  const add = () => {
    const address = draft.trim();
    if (address === "") return;
    const error = validateRecipient(address);
    if (error) {
      setDraftError(error);
      return;
    }
    if (!value.includes(address)) onChange([...value, address]);
    setDraft("");
    setDraftError(undefined);
  };

  const remove = (address: string) => {
    onChange(value.filter((item) => item !== address));
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter 로 폼 전체가 제출되지 않게 막고 주소를 추가한다.
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  };

  const descriptionIds = [draftError ? draftErrorId : undefined, describedBy].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul aria-label="수신자 목록" className="flex flex-wrap gap-2">
          {value.map((address) => (
            <li
              key={address}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-0.5 pl-2.5 text-sm"
            >
              <span>{address}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                aria-label={`${address} 제거`}
                onClick={() => remove(address)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">수신자가 없습니다.</p>
      )}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="name@example.com"
          className="max-w-72"
          value={draft}
          aria-invalid={draftError || invalid ? true : undefined}
          aria-describedby={descriptionIds === "" ? undefined : descriptionIds}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(undefined);
          }}
          onKeyDown={handleKeyDown}
        />
        <Button type="button" variant="outline" onClick={add}>
          <PlusIcon aria-hidden="true" />
          추가
        </Button>
      </div>
      {draftError && <FieldError id={draftErrorId}>{draftError}</FieldError>}
    </div>
  );
}
