/** 서버 로그. 테스트는 기록용 가짜를 주입해서 경고(EC-12 등)를 확인한다. */
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const consoleLogger: Logger = console;
