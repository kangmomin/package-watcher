/** 파일 1개가 여러 종류의 결과를 내는 "보조 파일"의 종류 */
export type SourceKind = "workflow" | "dockerfile" | "compose" | "mcp" | "action";

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

/** `uses: owner/repo[/path]@ref` 의 외부 action */
export interface ActionRef {
  /** owner/repo (소문자) */
  name: string;
  /** `@` 뒤의 ref. 없으면 "" */
  ref: string;
  /** 원문 */
  raw: string;
}

/** Docker 이미지 참조 */
export interface ImageRef {
  /** 정규화한 저장소 이름 (normalizeImageName) */
  name: string;
  /** tag. 없으면 "latest" (digest 만 있으면 "") */
  tag: string;
  /** `sha256:…` 또는 "" */
  digest: string;
  raw: string;
}

/** workflow·action.yml 에서 한 번에 나오는 사실 */
export interface SourceRefs {
  commands: CommandPackage[];
  actions: ActionRef[];
  images: ImageRef[];
  /** 셸 스크립트(run·RUN)에 `curl … | sh` 가 있다 (없으면 생략) */
  curlPipe?: boolean;
}

export interface SourceFacts extends SourceRefs {
  path: string;
  kind: SourceKind;
  /** `curl … | sh` 형태의 설치가 있는가 (workflow·action.yml·Dockerfile) */
  hasCurlPipeShell: boolean;
  /** workflow 에 최상위 `permissions` 도 없고 모든 job 에 있지도 않다 (workflow 가 아니면 false) */
  missingPermissions: boolean;
}
