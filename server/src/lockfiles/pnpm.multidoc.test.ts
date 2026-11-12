import { describe, expect, it } from "vitest";
import { expectInputRejected, packageKeys } from "../test/assertions.ts";
import { PNPM_V9, PNPM_V9_EXPECTED } from "./__fixtures__/index.ts";
import { parsePnpmLock } from "./pnpm.ts";

/** pnpm 11 이 만드는 형태: 첫 문서 = pnpm 자신의 의존성, 둘째 문서 = 프로젝트 */
const MULTI_DOC = `---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}
    packageManagerDependencies:
      '@pnpm/exe':
        specifier: 11.7.0
        version: 11.7.0
      pnpm:
        specifier: 11.7.0
        version: 11.7.0

packages:

  '@pnpm/exe@11.7.0':
    resolution: {integrity: sha512-exe}

  pnpm@11.7.0:
    resolution: {integrity: sha512-pnpm}

snapshots:

  '@pnpm/exe@11.7.0': {}

  pnpm@11.7.0: {}

---
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      evil-pkg:
        specifier: ^1.0.0
        version: 1.0.0

packages:

  evil-pkg@1.0.0:
    resolution: {integrity: sha512-evil}

  react@18.3.1:
    resolution: {integrity: sha512-react}

snapshots:

  evil-pkg@1.0.0: {}

  react@18.3.1: {}
`;

describe("parsePnpmLock 다중 문서", () => {
  it("[SP-01] YAML 문서가 2개인 pnpm-lock.yaml 은 두 문서의 packages 를 모두 읽는다", () => {
    expect(packageKeys(parsePnpmLock(MULTI_DOC))).toEqual([
      "@pnpm/exe@11.7.0",
      "evil-pkg@1.0.0",
      "pnpm@11.7.0",
      "react@18.3.1",
    ]);
  });

  it("[SP-01] 문서가 1개인 파일의 결과는 그대로다", () => {
    expect(packageKeys(parsePnpmLock(PNPM_V9))).toEqual(PNPM_V9_EXPECTED);
  });

  it("[SP-01] 문서마다 lockfileVersion 표지가 있어야 한다 (둘째 문서에 없으면 예외)", () => {
    const broken = MULTI_DOC.replace("---\nlockfileVersion: '9.0'\n\nsettings:", "---\nsettings:");
    expectInputRejected(() => parsePnpmLock(broken));
  });

  it("[SP-01] 둘째 문서의 YAML 오류도 예외", () => {
    expectInputRejected(() => parsePnpmLock(`${MULTI_DOC}---\nlockfileVersion: '9.0'\npackages: [unclosed\n`));
  });

  it("[SP-01] 주석뿐인 파일(문서 0개)은 형식 표지가 없는 것으로 거부한다", () => {
    expectInputRejected(() => parsePnpmLock("# 주석만 있는 파일\n"));
  });
});
