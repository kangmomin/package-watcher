/** 파일 1개가 여러 종류의 결과를 내는 "보조 파일"의 종류 */
export type SourceKind = "workflow" | "dockerfile" | "compose" | "mcp";

/** 명령(npx, pip install 등)으로 실행·설치하는 패키지 */
export interface CommandPackage {
  ecosystem: "npm" | "pypi";
  name: string;
  /** 정확한 버전 또는 "" (없음·latest·범위) */
  version: string;
  /** 원문 토큰, 예: "@playwright/mcp@latest" */
  raw: string;
  tool: string;
}

export interface SourceFacts {
  path: string;
  kind: SourceKind;
  commands: CommandPackage[];
}
