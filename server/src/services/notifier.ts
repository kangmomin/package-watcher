import type { TestEmailResult } from "@pw/shared";
import type { Clock } from "../clock.ts";
import type { SmtpConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { notImplemented } from "../notImplemented.ts";
import type { Repositories } from "../repositories/index.ts";

/** 메일 본문 최대 행 수. 넘으면 "외 N건, GUI에서 확인" 을 붙인다. */
export const MAIL_MAX_ROWS = 200;
/** SMTP connection·greeting·socket 타임아웃 */
export const SMTP_TIMEOUT_MS = 30_000;

export interface MailMessage {
  to: string[];
  subject: string;
  /** 일반 텍스트 본문 (repo, 파일 경로, 패키지@버전, 사유) */
  text: string;
}

export interface MailResult {
  accepted: string[];
  rejected: string[];
}

/** 발송 수단. 수신자 중 1명 이상이 수락(`accepted`)하면 성공이다. */
export interface Mailer {
  send(message: MailMessage): Promise<MailResult>;
}

/** nodemailer 구현 */
export function createSmtpMailer(smtp: SmtpConfig): Mailer {
  return notImplemented(smtp);
}

export interface Notifier {
  /**
   * `notifiedAt` 이 null 인 `open` 검출을 repo 별로 묶어 메일로 보낸다(최대 MAIL_MAX_ROWS 행).
   * 발송 성공 시에만 그 검출의 `notifiedAt` 을 기록한다. 수신자 0명이면 보내지 않는다.
   * SMTP 실패는 throw 하지 않는다(로그만).
   */
  notifyNewFindings(): Promise<void>;
  /** 일일 요약: `open` 검출만. 0건 또는 수신자 0명이면 보내지 않는다. */
  sendDigest(): Promise<void>;
  /** 저장된 수신자에게 테스트 메일. `NO_RECIPIENTS` / `SMTP_NOT_CONFIGURED` / `SMTP_FAILED` (AppError) */
  sendTestEmail(): Promise<TestEmailResult>;
}

export interface NotifierDeps {
  repos: Repositories;
  mailer: Mailer;
  smtpConfigured: boolean;
  clock: Clock;
  logger: Logger;
}

export function createNotifier(deps: NotifierDeps): Notifier {
  return notImplemented(deps);
}
