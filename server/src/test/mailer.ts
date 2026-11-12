import type { MailMessage, MailResult, Mailer } from "../services/notifier.ts";

/**
 * 테스트용 Mailer. 모든 호출을 `attempts` 에, 수락된 메일을 `sent` 에 기록한다.
 * `failWith` 가 있으면 throw(SMTP 실패), `rejectAll` 이면 모든 수신자를 거부한다.
 */
export class FakeMailer implements Mailer {
  readonly attempts: MailMessage[] = [];
  readonly sent: MailMessage[] = [];
  failWith: Error | null = null;
  rejectAll = false;

  async send(message: MailMessage): Promise<MailResult> {
    const copy: MailMessage = { ...message, to: [...message.to] };
    this.attempts.push(copy);
    if (this.failWith) throw this.failWith;
    if (this.rejectAll) return { accepted: [], rejected: [...copy.to] };
    this.sent.push(copy);
    return { accepted: [...copy.to], rejected: [] };
  }

  /** 그 주소가 수신자로 들어간 발송 성공 메일 */
  sentTo(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to.includes(address));
  }

  /** 발송 성공 메일 본문을 모두 이어 붙인 것 */
  sentText(): string {
    return this.sent.map((message) => `${message.subject}\n${message.text}`).join("\n----\n");
  }

  clear(): void {
    this.attempts.length = 0;
    this.sent.length = 0;
  }
}
