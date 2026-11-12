import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const noGh = () => null;
const base = { SMTP_HOST: "smtp.example.com", SMTP_FROM: "pw@example.com", SMTP_PORT: "2525" };

describe("loadConfig boolean env", () => {
  // Backend Plan config.ts: boolean env 는 "true"/"1" 만 true 다(대소문자 변형은 참이 아니다).
  it.each([
    ["true", true],
    ["1", true],
    [" true ", true],
    ["TRUE", false],
    ["True", false],
    ["yes", false],
    ["0", false],
  ])('[CT-09] SMTP_SECURE="%s" → secure %s', (value, secure) => {
    expect(loadConfig({ ...base, SMTP_SECURE: value }, noGh).smtp?.secure).toBe(secure);
  });
});
