# Plan: package-watcher 풀스택 구현

## Context

- **왜:** GitHub org의 Node.js repo에 블랙리스트 패키지가 들어왔는지 사람이 직접 확인할 방법이 없다. 주기 스캔 + 이메일 + GUI + MCP로 자동화한다.
- **기준 문서:** `C:\workspace\package-watcher\docs\20261112-package-watcher-spec.md` (상태: 구현 준비 완료, AC 14 · EC 13 · F 6). 이 Plan은 그 Spec을 구현 단위로 나눈 것이다. Spec과 다르면 Spec이 우선한다. 단, `## Assumptions`에 적은 항목은 사용자가 이 Plan을 승인하면 Spec보다 우선한다(Spec 파일도 같은 커밋에서 그 내용으로 갱신한다).
- **현재 상태:** 저장소에 코드가 없다. `docs/`, `.claude/`(profile 2개), `.conventions.json`만 있다(미커밋). 재사용할 기존 코드는 없다.
- **결과:** Docker 컨테이너 1개(포트 3000)가 스캔, REST API, GUI, MCP를 모두 제공한다.

### 작업 계약
- 대상: `C:\workspace\package-watcher`, remote `origin` = `github.com/kangmomin/package-watcher`(비공개), base 브랜치 `master`, 작업 브랜치 `feature/package-watcher`.
- 기준: 위 Spec + 이 Plan의 Assumptions. 참조 구현 없음(신규).
- 범위: Spec의 범위 전체 / 제외: 로그인, 여러 org, 자동 수정 PR, 이메일 외 알림, Playwright E2E, 원격 서버 배포, `bun.lockb` 파싱.
- 완료: AC-01~14, EC-01~13, CT-01~14 통과. 증거 = 단위 테스트 + API 통합 테스트(GitHub·SMTP mock) + 수동 확인(Docker, GUI 4화면, MCP). README에 실행 방법과 env 목록.
- 승인: 사용자가 `/common:start-workflow --fs`로 구현을 지시했다. 원격 정책 `pr`(feature 브랜치 → push → Draft PR). GitHub repo 생성은 사용자가 지시했다.
- 미결: 없음.

### 실행 설정 (Pre-flight 확정값)
| 항목 | 값 |
|------|-----|
| RUN_ID | `b7fa2e9af22e4bf0a043b96b24643057` |
| 모드 / 티어 | fullstack Build / `standard`(고정) |
| PUBLISH_POLICY | `pr` |
| Codex | `none` → 리뷰는 Claude 패널 |
| TDD | 켜짐. 회고(`--reflect`)는 꺼짐 |
| 오버레이 | `minmos-harness` 적용 안 함 (사용자 결정) |
| 로컬 도구 | Node v24.11.1, npm 11.7.0, Docker 29.9.2 |

### 승인할 때 확인할 것 (Spec과 달라지는 곳)
| 항목 | 내용 |
|------|------|
| A-1 | lockfile 귀속: "같은 폴더" → "같은 폴더 + 선언된 workspace". 모노레포 오탐 방지 |
| A-8 | 대시보드 표와 스캔 이력 표 아래에 페이저 추가 (확정 레이아웃에 없던 요소) |
| A-9 | 블랙리스트 중복 오류를 toast가 아니라 Dialog의 이름 필드 아래에 표시 |
| A-10 | org를 바꾸면 현재 검출이 모두 `resolved`가 된다. 대상에서 빠진 repo의 검출도 `resolved` |
| A-12 | 블랙리스트 수정은 전체 교체. 수정하면 기존 검출의 사유도 바로 바뀐다 |
| A-13 | lockfile이 없는 repo의 `"next": "latest"` 같은 spec은 "모든 버전" 항목에만 검출된다 |
| 원격 효과 | 브랜치 `feature/package-watcher` 생성 → 커밋 → push → Draft PR (`master` 대상) |
| 미검증 예정 | 실제 org 스캔과 실제 SMTP 발송은 사용자의 토큰·SMTP 계정이 있을 때만 확인한다 |

### Plan Verification Log
| 단계 | 결과 | 반영 |
|------|------|------|
| Phase 3 Batch 1 (BE advisor, FE advisor) | `CONCERN` ×2 | 지적 20건 반영 → 계약 v1.1 |
| Phase 3 Batch 2 (교차 리뷰 A, B) | `CONCERN` ×2 | 지적 13건 반영 → 계약 v1.2 |
| Phase 4.4 iteration 1 (Claude 패널: Logic / Architecture / Edge Cases) | `REJECT` ×3 → 종합 `REJECT` | 지적 19건 반영, 기각 0건 → 계약 v1.3. 주요: Docker 토큰 전달·데이터 경로, 의존성 설치 주체, blob API, 파서 정규화, 스캔 예외 경로 |
| Phase 4.4 iteration 2 | `APPROVE` / `APPROVE` / `CONCERN` → 종합 `CONCERN` | 지적 1건(② 안전장치 기준) + 제안 10건 반영, 기각 0건 |
| Phase 4.4 iteration 3 | Edge Cases `APPROVE` (Logic·Architecture는 iteration 2의 `APPROVE` 유지 — 이후 변경은 Edge Cases 지적 1건과 두 리뷰어 자신의 제안뿐) → 종합 `APPROVE` | 제안 1건(`listed_baseline`) 반영 |

- Convergence: PROCEED (3회). 잔존 이슈: 없음.

---

## Feature Matrix

| ID | 사용자 흐름 | 프론트 책임 | 백엔드 책임 | 완료 조건 |
|----|------------|------------|------------|----------|
| F-01 | 자동 스캔과 알림 | 없음 | 스케줄러, 스캔, 검출 저장, 신규 메일, 일일 요약 | AC-01~06, EC-01~04, EC-10, EC-12, EC-13 |
| F-02 | 검출 결과 조회·무시 | 대시보드 `/` (카드 4개, 필터, 표, 행 메뉴, 페이저) | `GET /api/summary`, `GET/PATCH /api/findings` | AC-07, AC-08, CT-02~04 |
| F-03 | 블랙리스트 관리 | `/blacklist` 표 + 추가/수정 Dialog + 삭제 확인 | `/api/blacklist` CRUD | AC-09, EC-07~09, CT-05, CT-13 |
| F-04 | 스캔 이력·수동 실행 | `/scans` 표 + [지금 스캔] + 행 펼침 + 페이저 | `GET/POST /api/scans`, `GET /api/scans/:id` | AC-10, EC-05, EC-06, CT-06, CT-07 |
| F-05 | 설정 변경 | `/settings` 폼 + [테스트 메일] | `GET/PUT /api/settings`, `POST /api/settings/test-email` | AC-11, AC-12, EC-11, CT-08, CT-09, CT-14 |
| F-06 | AI의 MCP 작업 | 없음 | `/mcp` tool 10개 | AC-13, AC-14, CT-11 |

---

## Integration Contract (v1.3 — Phase 3 리뷰 4회 + Plan 검증 1회차 반영)

### Surface
- REST (JSON) + MCP Streamable HTTP(`/mcp`). GUI는 REST만 사용한다.
- 인증/권한: 없음. compose가 `127.0.0.1:3000`에만 연다 (Spec D-11).
- 형식: 날짜 = ISO 8601 UTC 문자열(`2026-11-12T00:00:00.000Z`). ID = 정수. enum = 소문자 문자열. nullable 필드는 생략하지 않고 `null`을 보낸다.
- 하위 호환성: 해당 없음(신규).

### 공통 타입 (모두 `shared/src/contract.ts`에 zod 스키마 + 타입으로 둔다)
```ts
type FindingStatus  = "open" | "resolved" | "ignored";
type DependencyType = "direct" | "transitive";
type ScanTrigger    = "scheduled" | "manual";
type ScanStatus     = "running" | "success" | "partial" | "failed";
type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "INVALID_STATE" | "DUPLICATE_ENTRY"
  | "SCAN_RUNNING" | "ORG_NOT_SET" | "TOKEN_MISSING" | "NO_RECIPIENTS"
  | "SMTP_NOT_CONFIGURED" | "SMTP_FAILED" | "INTERNAL_ERROR";

// ---- 응답 ----
interface Finding {
  id: number;
  repo: string;                 // org를 뺀 repo 이름
  filePath: string;             // 검출된 package.json 또는 lockfile 경로
  packageName: string;
  version: string;              // lockfile 버전. range 검사로 검출했으면 range 문자열
  dependencyType: DependencyType; status: FindingStatus;
  blacklistEntryId: number;
  reason: string;               // 블랙리스트 사유. 항목을 PUT 하면 활성 검출의 값도 갱신된다
  htmlUrl: string;              // https://github.com/{org}/{repo}/blob/HEAD/{filePath}. 검출 시점에 저장
  firstSeenAt: string; resolvedAt: string | null; notifiedAt: string | null;
}
interface BlacklistEntry {
  id: number; name: string; versionRange: string | null; reason: string;
  createdAt: string; updatedAt: string;
}
interface Scan {
  id: number; trigger: ScanTrigger; status: ScanStatus;
  startedAt: string; finishedAt: string | null;   // running 이면 null
  repoCount: number; newFindingCount: number;      // running 중에는 0. 종료 시 1회 기록
  failedRepos: { repo: string; error: string }[];  // running 중에는 []
  error: string | null;                            // status=failed 일 때 원인
}
interface Summary {
  openCount: number; ignoredCount: number;
  lastScan: Scan | null;        // startedAt 이 가장 최신인 1건 (trigger·status 무관, running 포함)
  nextScanAt: string | null;    // org 또는 토큰이 없으면 저장값과 무관하게 null
}
interface Settings {
  org: string | null;                          // 미설정 = null
  scanIntervalHours: number;                   // 1~168, 기본 24
  digestTime: string;                          // "HH:mm", 기본 "09:00"
  digestTimezone: "Asia/Seoul";                // 고정, 읽기 전용
  recipients: string[];
  githubTokenSource: "env" | "gh" | "none";    // 읽기 전용. 서버 시작 시 1회 해석
  smtpConfigured: boolean;                     // 읽기 전용. SMTP_HOST 와 SMTP_FROM 이 있으면 true
}
interface Page<T> { items: T[]; total: number; page: number; limit: number; }
interface TestEmailResult { ok: true }
interface ApiError { error: { code: ErrorCode; message: string; details?: Record<string, string> } }

// ---- 요청 ----
interface BlacklistInput   { name: string; versionRange: string | null; reason: string } // POST 는 versionRange 생략 가능(= null). PUT 은 3개 키 모두 필수(전체 교체)
interface FindingStatusInput { status: "ignored" | "open" }
interface SettingsInput    { org: string; scanIntervalHours: number; digestTime: string; recipients: string[] }
interface FindingsQuery    { status?: FindingStatus; repo?: string; package?: string; page?: number; limit?: number }
interface ScansQuery       { page?: number; limit?: number }
```
- shared는 `toDetails(zodError): Record<string,string>` 헬퍼도 제공한다. BE(응답 생성)와 FE(제출 전 검증)가 같은 스키마와 같은 헬퍼를 쓴다.

### Endpoint
| Method | Path | Request | 성공 응답 | 오류 |
|--------|------|---------|-----------|------|
| GET | `/api/summary` | - | 200 `Summary` | - |
| GET | `/api/findings` | `FindingsQuery` (`page` 기본 1, `limit` 기본 50, 최대 200) | 200 `Page<Finding>` | 400 `VALIDATION_ERROR` |
| PATCH | `/api/findings/:id` | `FindingStatusInput` | 200 `Finding` | 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`, 409 `INVALID_STATE` |
| GET | `/api/blacklist` | - | 200 `{ items: BlacklistEntry[] }` (`name` 오름차순, 같으면 `id` 오름차순) | - |
| POST | `/api/blacklist` | `BlacklistInput` | 201 `BlacklistEntry` | 400 `VALIDATION_ERROR`, 409 `DUPLICATE_ENTRY` |
| PUT | `/api/blacklist/:id` | `BlacklistInput` (전체 교체) | 200 `BlacklistEntry` | 400, 404 `NOT_FOUND`, 409 `DUPLICATE_ENTRY` |
| DELETE | `/api/blacklist/:id` | - | 204 (본문 없음) | 404 `NOT_FOUND` |
| GET | `/api/scans` | `ScansQuery` (`page` 기본 1, `limit` 기본 20, 최대 100) | 200 `Page<Scan>` (`startedAt` 내림차순, 같으면 `id` 내림차순) | 400 `VALIDATION_ERROR` |
| GET | `/api/scans/:id` | - | 200 `Scan` | 404 `NOT_FOUND` |
| POST | `/api/scans` | 본문 없음 | 202 `Scan` (`status=running`, `trigger=manual`) | 400 `ORG_NOT_SET`, 400 `TOKEN_MISSING`, 409 `SCAN_RUNNING` |
| GET | `/api/settings` | - | 200 `Settings` | - |
| PUT | `/api/settings` | `SettingsInput` | 200 `Settings` | 400 `VALIDATION_ERROR` |
| POST | `/api/settings/test-email` | 본문 없음. **저장된** 수신자에게 보낸다 | 200 `TestEmailResult` | 400 `NO_RECIPIENTS`, 400 `SMTP_NOT_CONFIGURED`, 502 `SMTP_FAILED` |

### 필터·정렬·검증 규칙
- `GET /api/findings`: `status` 생략 = 모든 상태. `repo`, `package` = trim 후 대소문자 무시 부분 일치, 빈 문자열은 생략과 같다. 정렬 = `firstSeenAt` 내림차순, 같으면 `id` 내림차순. `total` = 필터 적용 후 전체 개수.
- 페이지네이션: offset(`page`, `limit`). `page < 1`, `limit < 1`, `limit` > 최대값, 정수 아님 → 400 `VALIDATION_ERROR`(clamp 하지 않는다). 범위를 넘은 `page`는 200 + 빈 `items`.
- `name`: trim, npm 패키지 이름 규칙(스코프 포함, 1~214자), 대소문자 구분. `versionRange`: trim, `null` 또는 빈 문자열 → `null`. 그 외는 유효한 semver range. `reason`: trim, 1~500자.
- 중복 판정(`DUPLICATE_ENTRY`): 정규화한 (`name`, `versionRange`)가 다른 항목과 같으면 409. `null` 범위끼리도 중복이다. PUT은 자기 자신을 뺀다(같은 값으로 PUT → 200).
- `org`: trim 후 **소문자로 정규화**해서 저장한다. 영숫자·하이픈 1~39자, 하이픈으로 시작·끝 불가, 연속 하이픈 불가. 정규화한 값이 같으면 "org 변경"이 아니다. `scanIntervalHours`: 정수 1~168. `digestTime`: `HH:mm`(00:00~23:59). `recipients`: 이메일 형식, trim, 중복 제거, 빈 배열 허용.
- `details` 키 = 요청 본문의 최상위 필드 이름(`name`, `versionRange`, `reason`, `status`, `org`, `scanIntervalHours`, `digestTime`, `recipients`) 또는 query 파라미터 이름. 배열 원소 오류는 `recipients` 1개로 합치고 메시지에 해당 값을 넣는다.
- 경계 케이스: 정수가 아닌 `:id` → 404 `NOT_FOUND`. 깨진 JSON 본문 또는 JSON이 아닌 Content-Type → 400 `VALIDATION_ERROR`(`details` 없음). 등록되지 않은 `/api/*` → 404 `NOT_FOUND`(SPA HTML로 폴백하지 않는다).
- `POST /api/scans` 판정 순서: `ORG_NOT_SET` → `TOKEN_MISSING` → `SCAN_RUNNING`.

### 상태·동작 규칙 (계약의 일부)
**검출 상태**
- 전이: (없음) → `open`(스캔). `open` ↔ `ignored`(PATCH). `open`/`ignored` → `resolved`(스캔, 블랙리스트 삭제, org 변경). `resolved`는 종착 상태다. 다시 나타나면 새 `open` 행을 만든다.
- PATCH: `resolved` 행 → 409 `INVALID_STATE`. 같은 상태로의 요청 → 200(변경 없음). PATCH는 `notifiedAt`을 바꾸지 않는다.
- 스캔은 기존 활성 행의 `open`↔`ignored`를 바꾸지 않는다. 신규 생성과 resolve만 한다. 다시 보인 활성 행은 `last_seen_at`과 `dependency_type`만 갱신한다.
- resolve 대상(org 목록 조회가 성공한 스캔에서): ① 성공적으로 스캔한 repo에서 이번에 안 보인 활성 검출 ② 대상 목록에 없는 repo의 활성 검출 — 단, 그 repo를 `GET /repos/{org}/{repo}`로 다시 확인해서 404 또는 archived/fork일 때만 resolve한다. 응답의 `full_name`이 `{org}/{repo}`와 다르면(대소문자 무시, 이름 변경·이전) resolve한다. 200이고 같은 이름의 활성 repo이면 `failedRepos`에 넣고 유지하고, 그 외 오류도 유지한다. 안전장치: 대상 목록이 0개이거나, 이번 목록의 전체 repo 수(archived·fork 포함)가 기준값보다 절반 넘게 줄었으면 토큰 접근 축소로 보고 ② resolve를 모두 보류하고 그 repo들을 `failedRepos`("접근 불가 의심")에 넣는다. 그 외에는 404를 그대로 resolve한다(repo 여러 개를 삭제해도 정상 처리). 기준값은 settings의 내부 키 `listed_baseline`이다(API 응답에는 없다). ② 보류 없이 끝난 `success`/`partial` 스캔만 이 값을 갱신하고, org를 바꾸면 비운다. 기준값이 없으면 "목록 0개" 조건만 적용한다. 재확인은 종료 트랜잭션 전에 끝낸다 ③ `package.json`이 0개가 된 repo(커밋이 없는 빈 repo 포함)의 활성 검출. 실패한 repo(`failedRepos`)의 검출은 그대로 둔다.
- "org 목록 조회 성공" = 모든 페이지를 받았다. 한 페이지라도 실패하면 목록 조회 실패다(스캔 `failed`, 생성·resolve 없음).
- "repo 스캔 성공" = tree와 필요한 모든 파일의 조회·파싱이 성공했다. 파일 1개라도 실패하면 그 repo 전체가 실패다(그 repo는 생성·resolve 없음). tree 조회가 409(빈 repo)이면 실패가 아니고 `package.json` 0개로 처리한다.
- 블랙리스트 `DELETE` → 그 항목의 활성 검출을 즉시 `resolved`. `PUT` → 그 항목의 활성 검출의 `reason`을 즉시 갱신. 매칭(`name`/`versionRange` 변경의 영향)은 다음 스캔이 다시 평가한다. 추가·수정은 스캔을 자동 실행하지 않는다.
- `PUT /api/settings`에서 `org`가 바뀌면(정규화 후 비교) 같은 트랜잭션에서 활성 검출을 모두 `resolved`로 바꾼다.

**스캔**
- 동시에 1개. 스캔은 시작할 때 org와 블랙리스트를 스냅샷하고, 모든 repo의 결과를 메모리에 모은다. 실행 중에는 `findings`를 쓰지 않는다.
- 종료할 때 **동기 트랜잭션 1개**에서 순서대로 처리한다: ① 설정의 현재 org가 스냅샷과 다르면 아무것도 쓰지 않고 `failed`(`error` 기록, `repoCount`·`newFindingCount` = 0)로 끝내고 메일도 보내지 않는다 ② 지금 존재하고 스냅샷 이후 `updatedAt`이 바뀌지 않은 블랙리스트 항목의 결과만 남긴다. 스캔 중 PUT된 항목은 신규 생성도 resolve ①도 하지 않는다(다음 스캔이 평가) ③ 검출 생성과 resolve ④ 스캔 행 마감. 트랜잭션이 끝난 뒤에 메일을 보낸다.
- 트랜잭션 전에 결과를 검출 키로 중복 제거한다(종류가 다르면 `direct` 우선). repo 목록도 이름으로 중복 제거한다.
- 예외 경로: 스캔 실행 전체를 try/catch/finally로 감싼다. 예상하지 못한 예외 → 스캔 행을 `failed` + `error`로 바꾸고 검출은 그대로 둔다. lock은 finally에서 항상 푼다(메일 발송이 끝난 뒤). 백그라운드 실행의 promise는 항상 catch한다(프로세스가 죽지 않는다). org 변경으로 `failed`가 된 스캔의 `failedRepos`는 `[]`이다.
- 메일 본문: repo별로 묶고 최대 200행. 넘으면 "외 N건, GUI에서 확인"을 붙인다. 메일 대상 검출은 모두 `notifiedAt`을 기록한다. 수신자 중 1명 이상이 수락하면 성공이다.
- `status`: org 목록 조회 실패(토큰 오류, org 없음) → `failed`. 종료했고 `failedRepos`가 1개 이상 → `partial`(모든 repo 실패도 `partial`). 그 외 → `success`.
- `repoCount` = archived·fork를 뺀 대상 repo 수(실패한 repo, Node가 아닌 repo 포함). `newFindingCount` = 이번 스캔이 만든 `open` 행 수.
- 신규 알림 메일은 `success`/`partial` 스캔과 목록 조회 실패(`failed`) 스캔의 종료 시 시도한다(미발송분 재시도 포함). org 변경으로 `failed`가 된 스캔만 예외다. SMTP 실패는 스캔 `status`를 바꾸지 않는다.

**스케줄 (`nextScanAt`)**
- `next_scan_at`을 settings에 저장한다. 값이 없고 org·토큰이 있으면 서버 시작 시 `시작 시각 + 1분`.
- 예정 시각이 되면: 스캔이 실행 중이 아니면 `scheduled` 스캔을 1회 시작하고, 실행 중이면 그 회차를 건너뛴다(스캔 행 없음). 두 경우 모두 `next_scan_at`을 원래 격자의 다음 미래 시각으로 옮긴다(`next + ceil((now − next) / interval) × interval`, `now == next`이면 `next + interval`). 서버가 오래 꺼져 있었어도 재시작 후 스캔은 1회만 실행한다.
- `PUT /api/settings`에서 `scanIntervalHours` 또는 `org`가 바뀌면 `nextScanAt = 저장 시각 + scanIntervalHours`. 다른 필드만 바뀌면 그대로 둔다.
- org 또는 토큰이 없으면 자동 스캔을 하지 않고 `nextScanAt = null`.
- 일일 요약: KST 날짜가 바뀌고 `digestTime`이 지났으면 1회. `open` 0건 또는 수신자 0명이면 보내지 않고 그날은 끝낸다. 발송 실패는 그날 다시 시도하지 않는다(로그만). `last_digest_date`는 발송 전에 기록한다. KST 계산은 `Intl`(`timeZone: "Asia/Seoul"`)만 쓴다(서버 TZ와 무관).
- tick: 이전 tick이 진행 중이면 이번 tick을 건너뛴다. tick 본문은 try/catch로 감싼다. tick은 스캔을 백그라운드로 시작만 하고 완료를 기다리지 않는다.
- SMTP 타임아웃(connection, greeting, socket)은 30초다. lock이 메일 발송 때문에 오래 잡히지 않게 한다.

### Error Contract
| code | HTTP | 발생 | 프론트 동작 |
|------|------|------|------------|
| `VALIDATION_ERROR` | 400 | 입력 검증 실패 | 변경 요청: `details`의 키가 폼 필드이면 그 필드 아래에 표시, 키가 없으면 `message`를 toast. GET 요청의 4xx: toast 없이 "GET 오류" 표현을 따른다 |
| `NOT_FOUND` | 404 | 대상 ID 없음 | toast + 그 화면의 목록 다시 조회 |
| `INVALID_STATE` | 409 | `resolved` 검출의 상태 변경 | toast + `findings`, `summary` 다시 조회 |
| `DUPLICATE_ENTRY` | 409 | 같은 `name`+`versionRange` | Dialog를 닫지 않고 `name` 필드 아래에 `message` 표시 |
| `SCAN_RUNNING` | 409 | 스캔 실행 중 | toast + `scans`, `summary` 다시 조회 |
| `ORG_NOT_SET` / `TOKEN_MISSING` | 400 | 스캔 전제 조건 없음 | toast + action "설정으로 이동". `TOKEN_MISSING`의 `message`는 env 안내 문장 |
| `NO_RECIPIENTS` / `SMTP_NOT_CONFIGURED` | 400 | 테스트 메일 전제 조건 없음 | toast |
| `SMTP_FAILED` | 502 | SMTP 발송 실패 | toast (`message`) |
| `INTERNAL_ERROR` | 500 | 그 외 | toast "서버 오류가 발생했습니다" |

- `message`는 사용자에게 보여 줄 수 있는 한국어 문장이다. 비밀값을 넣지 않는다.
- FE 전용 코드 `NETWORK_ERROR`(shared `ErrorCode`에는 없다): fetch 실패 또는 본문이 `ApiError` 스키마가 아닌 비-2xx 응답. 문구 "서버에 연결할 수 없습니다".
- `ApiRequestError`는 `status`(HTTP status, fetch 실패 = 0), `code`, `message`, `details`를 가진다. retry 판정은 `status`를 쓴다.
- `SMTP_NOT_CONFIGURED` 판정과 `Settings.smtpConfigured`는 같은 함수(`SMTP_HOST && SMTP_FROM`)를 쓴다.
- 변경 요청이 `INTERNAL_ERROR`/`NETWORK_ERROR`로 끝나거나 2xx인데 응답 parse에 실패하면 서버 상태를 알 수 없다. 이때 FE는 성공했을 때와 같은 키를 무효화한다.

### UI State Contract
공통:
- 모든 시각은 Asia/Seoul로 표시한다. 표 = `MM-dd HH:mm`, 카드 = `yyyy-MM-dd HH:mm`.
- GET 오류(첫 로드 실패일 때만) = 표 자리에 "데이터를 불러오지 못했습니다" + [다시 시도]. loading = `Skeleton`. 대시보드 카드: loading = 카드 `Skeleton`, 오류 = 값 "-" + 카드 영역 [다시 시도] 1개(표와 독립). 설정: loading = 폼 `Skeleton`, 오류 = 폼 자리에 오류 문장 + [다시 시도], [저장]·[테스트 메일] 숨김.
- 데이터가 이미 있는 상태의 재조회 실패(무효화, focus, polling)는 마지막 데이터를 유지하고 toast를 띄우지 않는다.
- "스캔 실행 중" 판정의 단일 소스 = `summary.lastScan?.status === "running"`. 대시보드와 `/scans`가 모두 `useSummary`를 사용하고, running인 동안 `summary`를 5초 polling한다. running이 끝나면 `scans`, `findings`, `summary`를 무효화한다.
- 페이저: `total === 0`이면 숨긴다. N = (page−1)×limit+1, M = min(page×limit, total). [이전]은 `page === 1`, [다음]은 `M >= total`일 때 비활성. empty 문구는 `total === 0`일 때만 쓴다. `items.length === 0 && total > 0 && page > 1`이면 `page = ceil(total/limit)`로 이동한다.
- TanStack Query: query retry = 4xx는 0회, 그 외 1회. mutation retry 0회. `staleTime: 0`, `refetchOnWindowFocus: true`. optimistic update 없음.
- FE는 응답을 shared 스키마로 parse한다. 실패하면 `INTERNAL_ERROR`로 처리한다.
- 라벨: `direct`/`transitive` = 직접/전이. `scheduled`/`manual` = 자동/수동. 상태 배지 = 영문 값 그대로(색 + 텍스트).

| 화면 | 표시 규칙 | empty | disabled / 무효화 |
|------|-----------|-------|-------------------|
| 대시보드 `/` | 카드: open 수, ignored 수, 마지막 스캔(`lastScan.startedAt` + 상태 배지, null이면 "스캔 이력 없음"), 다음 스캔(`nextScanAt`, null이면 "예정 없음"). 필터: 상태 select = open(기본)/ignored/resolved/전체(파라미터 생략), repo·패키지 입력은 trim + 300ms debounce, 비면 생략. 초기 요청 = `/api/findings?status=open&page=1&limit=50`. 필터 변경 → `page=1`. 표 아래 페이저 `[이전] N–M / total [다음]` | "검출이 없습니다" | 행 메뉴: open = 무시 + GitHub에서 보기 / ignored = 다시 열기 + GitHub에서 보기 / resolved = GitHub에서 보기만. PATCH 중 그 행 메뉴 비활성. PATCH 성공 → `findings`, `summary` 무효화 |
| 블랙리스트 `/blacklist` | 표: 이름, 버전 범위(null = "(모든 버전)"), 사유, 수정, 삭제. Dialog 필드: 이름*, 버전 범위(placeholder "비우면 모든 버전"), 사유*. 제출 전 shared 스키마로 검증 | "블랙리스트가 비어 있습니다" | 수정 Dialog 초기값: `versionRange` null → 빈 입력. 추가/수정 Dialog: 요청 중 [저장] 비활성 + 닫기 불가. 성공 → 닫기 + reset. `VALIDATION_ERROR`·`DUPLICATE_ENTRY`·`INTERNAL_ERROR`·`NETWORK_ERROR` → 열어 두고 입력 보존. `NOT_FOUND` → 닫기 + toast + `blacklist` 재조회. 삭제 확인 Dialog: 요청 중 [삭제] 비활성 + 닫기 불가. 성공 또는 `NOT_FOUND` → 닫기, 그 외 → 열어 둠. POST/PUT 성공 → `blacklist`, `findings` 무효화. DELETE 성공 → `blacklist`, `findings`, `summary` 무효화 |
| 스캔 이력 `/scans` | 표: 시작 시각, 종류, 상태, repo 수, 신규, 실패(`failedRepos.length`). `running` 행은 repo 수·신규·실패를 "-"로 표시. 행 펼침 = 목록 데이터의 `error`(null 아니면) + `failedRepos`. 둘 다 비면 펼칠 수 없다. FE는 `GET /api/scans/:id`를 호출하지 않는다. 페이저(limit 20) | "스캔 이력이 없습니다" | [지금 스캔] 비활성 조건: `summary` loading 중, 스캔 실행 중(공통 규칙의 단일 소스), 요청 중. 실행 중이고 page 1이면 `scans`도 5초 polling. POST 202 → `scans`, `summary` 무효화 |
| 설정 `/settings` | 폼: org(null → 빈 입력), interval(시간), 요약 시각 + "Asia/Seoul", 수신자 chip. 연결 상태(설정 여부 표시): GitHub 토큰 = env / gh CLI / 없음, SMTP = 설정됨 / 없음. 제출 전 shared 스키마로 검증 | 해당 없음 | org 입력 아래 안내 문구: "org를 바꾸면 현재 검출이 모두 resolved로 바뀝니다". 폼 reset은 첫 로드와 저장 성공 때만 한다(dirty 상태의 재조회는 폼을 덮어쓰지 않는다). 저장 중 [저장] 비활성. 저장 성공 → 응답 값으로 폼 reset + `settings`, `summary`, `findings` 무효화. [테스트 메일] 비활성 조건: 서버 `recipients` 0명, `smtpConfigured=false`, 폼 dirty(안내 "저장 후 테스트할 수 있습니다"), 요청 중 |

성공 toast 문구: 검출 상태 변경 "상태를 변경했습니다" / 블랙리스트 "항목을 추가했습니다"·"항목을 수정했습니다"·"항목을 삭제했습니다" / 스캔 "스캔을 시작했습니다" / 설정 "설정을 저장했습니다" / 테스트 메일 "테스트 메일을 보냈습니다".

### MCP (Streamable HTTP, `/mcp`, stateless)
tool 이름은 정확히 아래 10개. 각 tool은 대응 REST와 같은 서비스 함수를 호출하고, 결과 JSON을 text content로 반환한다. 오류(검증 실패 포함)는 `isError: true` + `{code, message, details?}` JSON. 요청마다 MCP 서버와 transport를 새로 만들고 응답 후 닫는다(동시 요청 안전). `GET /mcp`는 405.

| tool | 입력 | 결과 |
|------|------|------|
| `list_findings` | `FindingsQuery` | `Page<Finding>` |
| `set_finding_status` | `id`, `status` | `Finding` |
| `list_blacklist` | - | `{ items: BlacklistEntry[] }` |
| `add_blacklist_entry` | `name`, `versionRange?`, `reason` | `BlacklistEntry` |
| `update_blacklist_entry` | `id`, `name`, `versionRange`(필수, string\|null), `reason` | `BlacklistEntry` |
| `remove_blacklist_entry` | `id` | `{ ok: true, id }` |
| `trigger_scan` | - | `Scan` |
| `list_scans` | `ScansQuery` | `Page<Scan>` |
| `get_scan` | `id` | `Scan` |
| `get_settings` | - | `Settings` |

### Ownership
- Backend owner: `server/**`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `README.md`.
- Frontend owner: `web/**`.
- Shared artifact owner = **오케스트레이터**: `shared/**`(zod 스키마, 타입, `ErrorCode`, `toDetails`, fixture), 루트 `package.json`, `package-lock.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.prettierrc`, `docs/**`. 도메인 에이전트는 이 파일을 수정하지 않는다. 의존성이 더 필요하면 에이전트는 멈추고 요청한다. 오케스트레이터가 직렬로 설치(`npm install`, lock 갱신)한 뒤 재개한다. 에이전트는 `npm install`과 `shadcn add`를 실행하지 않는다.
- 공용 계약 테스트 owner: 오케스트레이터 (`shared/src/contract.test.ts`).
- fixture: shared가 기본 fixture와 변형을 제공한다 — Finding(open/ignored/resolved, direct/transitive, range 버전), Scan(running, success, partial+`failedRepos`, failed+`error`, scheduled/manual), Settings(기본, org null + token none + smtp false + 수신자 0명), Summary(기본, `lastScan` null + `nextScanAt` null), BlacklistEntry(range 있음, null), ApiError(details 있음/없음). 더 필요한 변형은 web 테스트가 spread override로 만든다.

### 검증 조항 (`CT-nn`)
| ID | 조항 | 검증 방법 | 담당 |
|----|------|----------|------|
| CT-01 | shared의 모든 fixture(Finding, BlacklistEntry, Scan, Summary, Settings, Page, TestEmailResult, ApiError)가 각 zod 스키마를 통과한다. 입력 스키마는 규칙 밖의 값을 거부한다 | shared 단위 테스트 | 공용 |
| CT-02 | `GET /api/findings`: 200 + `Page<Finding>`. `status`/`repo`/`package` 필터, 정렬, `page`/`limit`/`total`, 범위 밖 `limit` → 400 | BE: API 통합 테스트(응답을 shared 스키마로 parse). FE: 초기 요청 URL, 필터 변경 시 URL + `page=1`, 페이저 규칙, 빈 페이지 → 마지막 페이지로 이동 | 양쪽 |
| CT-03 | `PATCH /api/findings/:id`: 200 `Finding` / 404 / 409 `INVALID_STATE` / 400. PATCH 후 `summary.ignoredCount`가 일치 | BE 통합 테스트. FE: 상태별 행 메뉴, 성공 시 `findings`+`summary` 재조회 | 양쪽 |
| CT-04 | `GET /api/summary`: `Summary` 스키마. `openCount` = `GET /api/findings?status=open`의 `total`. `lastScan`은 최신 1건(running 포함) | BE 통합 테스트. FE: 카드 4개 + null 문구 | 양쪽 |
| CT-05 | 블랙리스트 CRUD: POST 201 / PUT 200 / DELETE 204 / GET `{items}`. 400(+`details`), 404, 409 `DUPLICATE_ENTRY`(null 범위 중복 포함), 같은 값 PUT → 200 | BE 통합 테스트. FE: Dialog 필드 오류, 409를 `name` 아래 표시 | 양쪽 |
| CT-06 | `POST /api/scans`: 202 `Scan(running, manual)` / 400 `ORG_NOT_SET` / 400 `TOKEN_MISSING` / 409 `SCAN_RUNNING`, 판정 순서 포함 | BE 통합 테스트. FE: 버튼 비활성 조건(page 2에서 실행 중일 때 포함), polling, 오류 toast | 양쪽 |
| CT-07 | `GET /api/scans`: `Page<Scan>`(최신 순). `GET /api/scans/:id`: `failedRepos` 포함, 없으면 404 | BE 통합 테스트. FE: 행 펼침(`error` + `failedRepos`), running 행 "-" | 양쪽 |
| CT-08 | `GET/PUT /api/settings`: `Settings` 스키마. 잘못된 값 → 400(+`details`). 응답에 비밀값 없음. `org` 변경 → 활성 검출 `resolved`. 대소문자만 다른 `org` 저장 → 변경 아님(검출·`nextScanAt` 불변) | BE 통합 테스트. FE: 폼 필드 오류, 연결 상태, 저장 후 reset | 양쪽 |
| CT-09 | `POST /api/settings/test-email`: 200 `{ok:true}` / 400 `NO_RECIPIENTS` / 400 `SMTP_NOT_CONFIGURED` / 502 `SMTP_FAILED` | BE 통합 테스트(SMTP mock). FE: 비활성 조건 4개, toast | 양쪽 |
| CT-10 | 모든 4xx/5xx 본문은 `ApiError` 스키마. 등록되지 않은 `/api/*` → 404 `ApiError`. 깨진 JSON → 400 | BE 통합 테스트. FE: `api` 클라이언트가 `ApiRequestError`를 던짐, 비-`ApiError` 본문 → `NETWORK_ERROR` | 양쪽 |
| CT-11 | `/mcp`의 `tools/list`는 위 10개 이름을 정확히 반환. `add_blacklist_entry` → REST 목록에 나타남. `trigger_scan` → `manual` 스캔 생성. 검증 실패 → `isError`. 동시 2요청과 연속 3요청이 모두 성공 | BE 통합 테스트(MCP 클라이언트) | BE |
| CT-12 | 날짜 필드는 ISO 8601 UTC, nullable 필드는 `null`로 존재 | CT-01 스키마 + BE 통합 테스트 | 양쪽 |
| CT-13 | 블랙리스트 DELETE 후 `GET /api/findings?status=resolved`에 그 항목의 검출이 있고 `resolvedAt`이 null이 아니다. `summary.openCount`가 줄어든다. PUT 후 활성 검출의 `reason`이 갱신된다 | BE 통합 테스트. FE: DELETE 성공 시 `blacklist`+`findings`+`summary` 재조회 | 양쪽 |
| CT-14 | 가짜 시계를 T로 고정하고 `PUT /api/settings`로 `scanIntervalHours=6` 저장 → `summary.nextScanAt === T + 6h`(정확히 일치). 다른 필드만 바꾸면 `nextScanAt` 불변. org·토큰 없으면 `null` | BE 통합 테스트(가짜 시계). 실행 지연은 스케줄러 단위 테스트: T+6h+30s tick → `scheduled` 스캔 1건, `nextScanAt = T+12h`. 3일 정지 후 재시작 → 스캔 1건 | BE |

---

## 저장소 구조 (npm workspaces)

```
package-watcher/
├─ package.json            workspaces: shared, server, web. scripts: build/test/lint/typecheck/dev
├─ tsconfig.base.json, eslint.config.js, .gitignore, .prettierrc
├─ shared/                 @pw/shared — src/contract.ts, src/fixtures.ts, src/contract.test.ts
├─ server/                 @pw/server — Hono, src/**, 테스트는 소스 옆 *.test.ts
├─ web/                    @pw/web — Vite + React + shadcn, src/**
├─ Dockerfile, docker-compose.yml, .dockerignore, .env.example, README.md
└─ docs/, .claude/, .conventions.json   (기존)
```

- 루트 scripts(= profile의 명령): `build`(web → server), `test`·`typecheck`(`npm run <x> --workspaces --if-present`), `lint`(eslint .), `dev`(`concurrently`: server `tsx watch` :3000 + web vite :5173, vite가 `/api`·`/mcp`를 3000으로 proxy).
- `@pw/shared`는 **빌드 없는 소스 패키지**다. `exports: { ".": "./src/index.ts", "./fixtures": "./src/fixtures.ts" }`. Vite, Vitest, tsx가 소스를 직접 읽는다. fixture는 subpath로 분리해서 운영 번들에 넣지 않는다. shared의 런타임 의존성은 브라우저에서 동작하는 것만 쓴다(`zod`, `semver`). npm 이름 검증은 정규식으로 한다.
- server 운영 빌드는 `tsup` 단일 번들이다(`@pw/shared`는 inline, `better-sqlite3`는 external). `typecheck`는 `tsc --noEmit`만 쓴다. web은 `paths: @/*`를 가진 단일 `tsconfig.json`이다.
- 인터페이스 고정값(FE·BE가 바꾸지 않는다): Vite `outDir: "dist"`, `base: "/"`. server는 정적 파일 경로를 `WEB_DIST_DIR` env(기본 = 번들 위치 기준 `../../web/dist`)로 찾는다.
- server는 `HOST` env로 listen한다. 기본 `127.0.0.1`, Dockerfile은 `0.0.0.0`. Vite proxy target은 `http://127.0.0.1:3000`. `web/dist`가 없으면(개발) server는 정적 파일 제공과 SPA 폴백을 건너뛴다. `.gitignore`에 `data/`(앵커 없음).
- 운영: server가 `web/dist`를 정적 파일로 제공한다. `/api/*`·`/mcp` 외의 GET은 `index.html`로 폴백한다(SPA).

---

## Backend Plan (owner: BE 구현 에이전트)

**스택:** Hono + `@hono/node-server`, `better-sqlite3`, `octokit`(throttling·retry 플러그인 포함), `tsup`, `nodemailer`, `semver`, `yaml`, `jsonc-parser`, `picomatch`, `@modelcontextprotocol/sdk`, `zod`, Vitest.

**파일 (`server/src/`)**
| 파일 | 역할 |
|------|------|
| `config.ts` | env 로드: `PORT`(3000), `DATA_DIR`(`./data`), `GITHUB_TOKEN`, `GITHUB_ORG`, `SMTP_HOST/PORT/USER/PASS/FROM/SECURE`, `SCAN_INTERVAL_HOURS`, `DIGEST_TIME`, `EMAIL_RECIPIENTS`. 토큰 해석(시작 시 1회): env → `gh auth token`(실패는 조용히 `none`). 빈 문자열 env는 "없음"이다. boolean env는 `"true"`/`"1"`만 true. `SMTP_SECURE` 기본값 = `port === 465`. `EMAIL_RECIPIENTS` 구분자는 쉼표. `HOST`, `WEB_DIST_DIR`도 읽는다 |
| `db/schema.ts`, `db/index.ts` | SQLite 열기, 시작 시 `CREATE TABLE IF NOT EXISTS` 4개. Spec "DB 변경"에 더해 `findings.reason`, `findings.html_url` 컬럼과 settings 키 `next_scan_at`, `last_digest_date`. `blacklist_entries.version_range`는 `NOT NULL DEFAULT ''`로 저장하고 API 경계에서 `''` ↔ `null` 변환(중복 판정용 unique). 시작 시 `mkdirSync(DATA_DIR, {recursive: true})`. 설정 초기값 env는 키별로 `SettingsInput` 규칙으로 검증·정규화하고(실패한 키는 기본값 + 경고 로그) 그 키가 settings에 없을 때만 넣는다(`INSERT OR IGNORE`, 이후 env 변경은 무시). 시작 시 `running`으로 남은 스캔은 `failed`("서버 재시작")로 바꾼다 |
| `repositories/*.ts` | `blacklist`, `findings`, `scans`, `settings` — SQL만 담당 |
| `lockfiles/{npm,yarn,pnpm,bun}.ts`, `lockfiles/index.ts` | 각 파서: 입력 = 파일 문자열, 출력 = `{name, version}[]`. npm v1/v2/v3, yarn classic/berry, pnpm v5/v6/v9, `bun.lock`(JSONC). 아래 "파서 정규화 규칙"을 따른다. 파싱 실패, 빈 입력, 형식 표지 없는 입력은 예외 |
| `matcher.ts` | `matchExact(version, range)` = `semver.satisfies(…, {includePrerelease: true})`. `matchRange(spec, range)`: `npm:` 별칭을 먼저 분해(실제 이름으로 매칭)한 뒤 `semver.validRange(spec) === null`이면 비-semver다(`latest` 같은 dist-tag, `catalog:`, `workspace:`, git, file, url, `user/repo`). 비-semver spec은 블랙리스트 range가 `null`일 때만 일치한다(A-13). 그 외는 `semver.intersects`. 두 함수는 절대 throw하지 않는다(잘못된 버전 문자열 → 불일치) |
| `workspaces.ts` | lockfile 담당 범위 계산: 루트 `package.json`의 `workspaces`(배열 또는 `.packages`)와 `pnpm-workspace.yaml`의 `packages` glob → 그 lockfile이 담당하는 `package.json` 목록 |
| `github/client.ts` | 인터페이스 `GitHubClient { listOrgRepos, getRepo, getTree, getFile }` + octokit 구현. `listOrgRepos`는 모든 페이지를 받은 배열을 반환하거나 throw한다. `getTree`는 `type === "blob"`이고 `mode !== "120000"`인 항목만 반환한다(symlink·서브모듈 제외). `getFile(repo, blobSha)`는 **blob API**(`git/blobs/{sha}`)를 쓴다 — contents API는 1MB 초과 파일을 읽지 못한다. sha는 tree 항목의 값이다(tree와 같은 커밋). 재시도: 5xx·네트워크 오류와 secondary rate limit(`retry-after`, 상한 60초)만 2회(409를 포함한 그 외 4xx는 재시도하지 않게 설정). primary rate limit 소진은 기다리지 않고 throw한다(스캔은 남은 repo를 `failedRepos`("RATE_LIMITED")로 처리하고 ② 재확인을 보류). 요청 타임아웃 30초. 스캔 테스트는 가짜 구현을 주입하고, octokit 구현은 fetch mock으로 따로 테스트한다 |
| `services/scanService.ts` | 스캔 1회: org·블랙리스트 스냅샷 → repo 목록 → (archived·fork 제외) → repo별 tree → `package.json`/lockfile 수집(`node_modules/` 제외) → 매칭 결과를 메모리에 수집 → 종료 시 동기 트랜잭션 1개(계약의 "스캔" 규칙) → 알림 호출. repo 동시 처리 5개. 동시 스캔 1개(in-process lock) |
| `services/findingService.ts`, `blacklistService.ts`, `settingsService.ts` | 검증(shared zod + `toDetails`) + "상태·동작 규칙". REST와 MCP가 함께 사용 |
| `services/notifier.ts` | 인터페이스 `Mailer { send }` + nodemailer 구현. 신규 검출 메일, 일일 요약 메일, 테스트 메일. 발송 성공 시에만 `notified_at` 기록 |
| `scheduler.ts` | 30초 tick, 시계 주입 가능. "스케줄 (`nextScanAt`)" 규칙 구현 |
| `routes/*.ts`, `app.ts` | REST 라우트, 오류 → `ApiError` 변환, `/api/*` 404, 정적 파일 + SPA 폴백 |
| `mcp/server.ts` | tool 10개 등록, `/mcp` 연결(stateless, 요청마다 새 인스턴스). transport 방식은 Phase 6.0에서 오케스트레이터가 설치된 SDK 문서를 확인해 정하고 의존성을 설치한다 |
| `index.ts` | 조립 + listen |

**파서 정규화 규칙**
| 대상 | 규칙 |
|------|------|
| 공통 | UTF-8 BOM 제거, CRLF → LF. 출력의 `name`은 실제 패키지 이름(별칭 분해). `package.json`의 별칭(`"x": "npm:real@^1"`)도 직접 의존성 이름 집합에서 `real`로 본다 |
| npm v2/v3 | `packages`만 읽는다(v2의 `dependencies`는 무시). 루트 `""`와 `link: true` 항목은 제외. 이름 = 항목의 `name` 필드, 없으면 마지막 `node_modules/` 뒤 경로 |
| npm v1 | `dependencies`를 재귀로 읽는다. `version: "npm:real@1.2.3"` 별칭 분해. 버전이 semver가 아닌 항목(git, tarball)은 이름만 낸다(버전은 원문) |
| yarn classic | 형식 표지 `# yarn lockfile v1`. 한 블록의 여러 spec은 같은 버전이다. 이름 = spec이 `@`로 시작하면 두 번째 `@` 앞, 아니면 첫 `@` 앞. `a@npm:real@^1` → `real` |
| yarn berry | 형식 표지 `__metadata`(제외). 이름 = `resolution` 필드에서 추출. `workspace:` 항목 제외. `patch:` 항목은 기본 패키지 이름 |
| pnpm | `packages`만 읽는다(v9의 `snapshots`는 무시). 키 형식: v5 `/name/1.0.0_peer`, v6 `/name@1.0.0(peer)`, v9 `name@1.0.0(peer)` — peer suffix를 뗀다. git/tarball 항목은 `name`/`version` 필드에서 읽는다 |
| bun.lock | `jsonc-parser`를 `allowTrailingComma: true`로 호출. `packages` 값 튜플의 [0](`name@version`)을 yarn 이름 규칙으로 분해 |

**lockfile 귀속 규칙 (A-1)**
- 모든 lockfile을 스캔한다. lockfile마다 독립적으로 검출을 만든다. 담당 `package.json`이 없는 lockfile의 검출은 모두 `transitive`다.
- lockfile이 담당하는 `package.json` = 같은 디렉터리의 것 + 그 디렉터리의 workspace 선언(glob)에 맞는 것. `pnpm-lock.yaml`은 `pnpm-workspace.yaml`의 `packages`만 읽고, 나머지 3종은 `package.json`의 `workspaces`(배열 또는 `.packages`)만 읽는다. glob은 lockfile 디렉터리 기준 상대 경로이고 디렉터리에 매칭하며 `!` 부정 패턴을 지원한다. 매칭 전에 `./` 접두와 끝의 `/`를 정규화한다. `pnpm-workspace.yaml`에 `packages`가 없거나 파일이 비어 있으면, 또는 `workspaces`가 배열도 `{packages}`도 아니면 glob 0개로 처리한다(예외 없음).
- 한 `package.json`이 여러 디렉터리의 lockfile에 맞으면 같은 디렉터리의 lockfile을 우선하고, 그다음 가장 가까운 디렉터리 1곳에만 귀속한다. 같은 디렉터리에 lockfile이 2종 이상이면 모두 담당 lockfile이다. range 검사 폴백은 그 의존성이 담당 lockfile 모두에 없을 때만 1회 한다.
- 담당 lockfile이 있는 `package.json`: 검출은 lockfile의 정확한 버전에서 만든다. `filePath` = lockfile 경로. 담당 `package.json`들의 직접 의존성 이름과 같으면 `direct`, 아니면 `transitive`. 직접 의존성이 lockfile에 없으면 그 의존성만 range 검사(`filePath` = 그 `package.json`, `version` = range 문자열, `direct`).
- 담당 lockfile이 없는 `package.json`(선언되지 않은 하위 폴더 포함): Spec 규칙대로 range 검사. `filePath` = `package.json`, `direct`.
- `bun.lockb`만 있음 → lockfile 없음으로 처리 + 경고 로그(EC-12).
- tree가 `truncated` 또는 파일 조회·파싱 실패 → 그 repo를 `failedRepos`에 기록(EC-13). tree 409(빈 repo) → `package.json` 0개로 처리.
- 검출 키 = (repo, file_path, package_name, version, blacklist_entry_id), 활성(`open`/`ignored`) 행에 대해 유일.

**테스트 전략 (Vitest)**
- 테스트 이름 규칙: 대응하는 ID를 접두로 붙인다(예: `[AC-05] …`, `[EC-03][CT-09] …`). Verification이 ID별 존재를 grep으로 확인한다.
- 단위: lockfile 파서 4종 — 변형별 fixture(npm v1 중첩·v3 link+별칭, pnpm v5 `_`·v6 `()` suffix·v9, yarn classic 다중 spec+scoped+git URL, berry patch/workspace, bun trailing comma, BOM/CRLF, 빈 입력 → 예외). `matcher`(`latest`, `catalog:`, `user/repo`, `github:u/r#sha`, `workspace:^`, `""`, `*`, `npm:lodash@^4`, 잘못된 버전 문자열 — 모두 throw 없음). `workspaces`. 스케줄러(가짜 시계 + 가짜 Mailer): CT-14, 일일 요약(KST 날짜 경계, `digestTime` 이전 미발송, 하루 1회, open 0건·수신자 0명, 발송 실패 후 재시도 없음, 재시작 후 유지 — AC-06), `TZ=UTC`와 `TZ=America/Los_Angeles`에서 실행.
- octokit 구현(fetch mock): 1.5MB blob, 빈 repo 409, 목록 페이지네이션과 2페이지 실패, 301 rename, primary rate limit.
- API 통합: `app.request()`로 호출. 임시 SQLite 파일 + 가짜 `GitHubClient` + 가짜 `Mailer`. 응답을 shared 스키마로 parse(CT-02~14).
- 스캔 시나리오: AC-01~06, EC-01~04, EC-09, EC-10, EC-12, EC-13 + resolve 대상 ①②③(② 재확인 3분기 포함) + 목록 2페이지 실패 → `failed`·검출 불변 + 빈 repo + 스캔 중 블랙리스트 삭제·PUT/ignored 유지/org 변경 + 중복 결과 3종 → 행 1개·`newFindingCount` 1 + 트랜잭션 예외 주입 → `failed`·다음 `POST /api/scans` 202 + k번째 repo에서 rate limit → 이후 repo 실패·검출 불변·lock 해제 + ② 안전장치(목록 0개 → 보류, 20개 중 검출 있는 2개 삭제 → 둘 다 `resolved`, 20개 → 5개 축소 → 보류, 축소가 2회 연속 → 두 번째 스캔도 보류, 보류 다음 스캔에서 목록 회복 → 정상 처리) + PATCH ignored 후 요약 본문에서 제외(AC-08)를 가짜 GitHub 데이터로 검증. AC-02의 fixture는 lockfile이 없는 repo다. `workspaces` 단위 테스트는 귀속 규칙 4개(담당 없는 lockfile, 이중 귀속, lockfile 2종, glob·부정 패턴)를 포함.
- MCP: SDK 클라이언트로 `tools/list`, `add_blacklist_entry`, `trigger_scan`(CT-11).

**배포 파일**
- `Dockerfile`(multi-stage, `node:24-slim`): build stage = 루트 lock + workspace `package.json` 3개 COPY → `npm ci` → `npm run build`. runtime stage = `npm ci --omit=dev -w server` + `server/dist` + `web/dist`. `ENV DATA_DIR=/data HOST=0.0.0.0 WEB_DIST_DIR=/app/web/dist`. `RUN mkdir -p /data && chown node:node /data` 뒤에 `USER node`.
- `docker-compose.yml`: `127.0.0.1:3000:3000`, volume `pw-data:/data`, `init: true`, `env_file: [{ path: .env, required: false }]`, `environment: { GITHUB_TOKEN: ${GITHUB_TOKEN:-} }`(셸의 값을 컨테이너에 전달).
- `.dockerignore`: `**/node_modules`, `**/dist`, `data`, `.env`, `.git`.
- `.env.example`: 값이 없는 키는 주석으로 둔다.
- `README.md`: 실행 방법(bash `GITHUB_TOKEN=$(gh auth token) docker compose up`, PowerShell `$env:GITHUB_TOKEN = gh auth token; docker compose up`), env 표(`config.ts`의 목록과 같아야 한다), "설정 env는 첫 실행에만 적용", MCP 연결 방법, 알려진 한계(tree가 `truncated`인 대형 repo와 깨진 `package.json`이 있는 repo는 매 스캔 `partial`).

---

## Frontend Plan (owner: FE 구현 에이전트)

**스택:** Vite + React + TypeScript, Tailwind + shadcn/ui, react-router, TanStack Query, react-hook-form + zod(shared 스키마 재사용), Vitest + Testing Library(jsdom).

**파일 (`web/src/`)**
| 경로 | 역할 |
|------|------|
| `lib/api.ts` | `fetch` 래퍼. 응답을 shared 스키마로 parse. 비-2xx → `ApiRequestError(status, code, message, details)`. 본문이 `ApiError`가 아니거나 fetch 실패 → `NETWORK_ERROR`. 204는 `undefined` |
| `lib/queryClient.ts`, `lib/queryKeys.ts` | retry 정책, `summary`, `findings(filter,page)`, `blacklist`, `scans(page)`, `settings` |
| `lib/format.ts` | KST 날짜 형식 2개, 라벨 매핑 |
| `app/App.tsx`, `app/AppLayout.tsx`, `app/router.tsx` | QueryClientProvider, 사이드바 레이아웃, 라우트 4개, Sonner |
| `components/ui/*` | shadcn 생성물: sidebar, card, table, badge, dialog, alert-dialog, form, input, select, dropdown-menu, skeleton, sonner, button |
| `components/DataState.tsx`, `components/Pager.tsx` | 공통 loading / empty / error(+[다시 시도]), 페이저 |
| `features/summary/*` | `useSummary`(단일 소스: running이면 5초 polling, running → 종료 전이를 감지해서 `scans`·`findings`·`summary` 무효화), `isScanRunning(summary)` |
| `features/findings/*` | `DashboardPage`, `SummaryCards`, `FindingsFilters`, `FindingsTable`, `useFindings`, `useSetFindingStatus` |
| `features/blacklist/*` | `BlacklistPage`, `BlacklistTable`, `BlacklistDialog`(추가/수정 공용), `DeleteConfirm`, hooks |
| `features/scans/*` | `ScansPage`, `ScansTable`(행 펼침), `ScanNowButton`, `useScans`(`isScanRunning(summary) && page === 1`이면 `refetchInterval: 5000`), `useTriggerScan` |
| `features/settings/*` | `SettingsPage`, `SettingsForm`, `RecipientsInput`, `ConnectionStatus`, `useSettings`, `useSaveSettings`, `useTestEmail` |

- 화면 동작은 "UI State Contract"와 "Error Contract"를 그대로 구현한다. 배치는 Spec의 "레이아웃 (확정)" + 표 아래 페이저(A-8).
- 타입과 zod 스키마는 `@pw/shared`에서 import한다. FE는 응답 모양을 직접 정의하지 않는다. 테스트 mock 데이터는 shared fixture를 사용한다.
- 접근성: 행 메뉴와 Dialog는 키보드로 조작 가능. 아이콘 버튼(수정, 삭제, 수신자 제거)에 `aria-label`. 상태 배지는 색 + 텍스트. 폼 오류는 `aria-describedby`로 연결.

**테스트 전략 (Vitest + Testing Library, `fetch` mock)**
- `api.ts`: `ApiRequestError` 변환, `NETWORK_ERROR`, 204(CT-10).
- 화면별: loading/empty/error, 초기 URL과 필터 URL(CT-02), 상태별 행 메뉴와 재조회(CT-03), 카드 null 문구(CT-04), Dialog 필드 오류와 409(CT-05), [지금 스캔] 비활성과 polling(CT-06), 행 펼침과 running "-"(CT-07), 설정 폼 검증·reset(CT-08), [테스트 메일] 비활성 조건(CT-09), DELETE 후 재조회(CT-13).
- Error Contract 코드별 동작: `INVALID_STATE`(toast + `findings`·`summary` 재조회, CT-03), `SCAN_RUNNING`(toast + `scans`·`summary` 재조회, CT-06), `NOT_FOUND`(Dialog 닫기 + 재조회, CT-05), `ORG_NOT_SET`/`TOKEN_MISSING`("설정으로 이동" action, CT-06), 변경 요청의 `INTERNAL_ERROR`/`NETWORK_ERROR`/parse 실패 → 성공 때와 같은 키 무효화(CT-10), 데이터가 있는 상태의 재조회 실패 → 마지막 데이터 유지 + toast 없음(CT-10), `format.ts`의 KST 형식 2개(CT-12), page 2에서 스캔 실행 중이면 버튼 비활성(CT-06).
- 테스트 이름 규칙: 대응하는 ID를 접두로 붙인다(예: `[CT-05] …`).

---

## 공용 Plan (owner: 오케스트레이터)

**순서**
1. Phase 5: 브랜치 `feature/package-watcher` 생성. 상태 파일 작성. 테스트 baseline = 수집할 테스트 없음(신규 저장소).
2. Phase 6.0 (오케스트레이터 스캐폴딩 게이트 — 끝나야 병렬 작업을 시작한다):
   - 루트 `package.json`(workspaces, scripts, `concurrently`), `tsconfig.base.json`, `.gitignore`, `.prettierrc`, `eslint.config.js`(`server/**` Node 블록, `web/**` React·hooks·a11y 블록, `web/src/components/ui/**` 완화, `**/dist` ignore).
   - `shared/`: contract, fixture, `toDetails`, CT-01 테스트.
   - `server/`, `web/`의 `package.json`에 **BE·FE 스택의 모든 의존성**(prod, dev, `@types/*`)을 넣고 `npm install` 1회. zod major는 1개로 고정한다(MCP SDK와 `@hookform/resolvers`가 모두 지원하는 버전). MCP transport 방식을 SDK 문서로 확정하고 필요한 패키지를 설치한다.
   - `web/`: Vite + Tailwind + shadcn 초기화(`shadcn init`, 컴포넌트 13개 `add`, 비대화형)와 `vite.config.ts`(alias, proxy, `outDir`), `tsconfig.json`, vitest 설정까지 만든다.
   - **스택 스모크 3개**(모두 통과해야 다음 단계): ① 로컬에서 `better-sqlite3`로 `:memory:` DB 열기 ② 빈 web의 `vite build` ③ 실제 multi-stage `Dockerfile`로 `docker build`(컨테이너 안에서 `npm ci` + `npm run build` 실행 — Linux용 optional 바이너리 확인). 빈 web과 hello 서버는 `@pw/shared`를 1번씩 import한다(소스 해석 확인). 게이트 끝에 루트 `npm run typecheck`, `lint`, `test`가 통과해야 한다. `tsconfig.base.json`은 `moduleResolution: "Bundler"`.
   - 스모크 실패 시 대안(순서대로): 빌드 도구(`python3 make g++`)를 가진 prod-deps stage에서 `npm ci --omit=dev -w server`를 실행하고 그 `node_modules`를 runtime stage로 COPY → lock 재생성 → `better-sqlite3`를 Node 내장 `node:sqlite`로 교체(Spec D-34가 라이브러리 변경을 허용).
   - Spec 파일을 Assumptions 내용으로 갱신. 커밋(기존 미커밋 파일 `docs/`, `.claude/`, `.conventions.json` 포함).
3. Phase 6.1 Red: BE·FE 에이전트가 `CT-nn`/`AC`/`EC` 근거의 실패 테스트를 먼저 작성. 양쪽 모두 유효 Red여야 다음으로 간다.
4. Phase 6.2 Green: BE·FE 구현 에이전트 병렬 실행. 파일 소유권은 "Ownership"을 따른다. 커밋은 오케스트레이터가 배리어 후 순차로 한다.
   - 병렬 중 규칙(6.1~6.2): 에이전트는 자기 workspace 명령만 쓴다(`npm test -w server`, `npm run typecheck -w web`, `npx eslint web`). 루트 명령은 배리어 후 오케스트레이터만 실행한다. 에이전트의 `npm install`과 `shadcn add`는 금지다.
   - 의존성이 더 필요하면: 에이전트는 멈추고 요청한다 → 오케스트레이터가 직렬로 설치 → 재개.
   - shared 변경이 필요하면: 에이전트는 멈추고 필요한 변경을 보고한다 → 오케스트레이터가 shared를 고치고 CT-01과 양쪽 typecheck를 실행 → 계약의 의미가 바뀌면 계약을 다시 리뷰한 뒤 재개.
   - 중단 기준: 같은 테스트가 3회 연속 같은 원인으로 실패하면 멈추고 보고한다.
5. Phase 7: 도메인별 품질 루프(BE → FE 순차): build, test, simplify, convention-check, lint, typecheck. BE E2E는 실제 GitHub 없이 로컬 서버로 CRUD, 설정, `ORG_NOT_SET`/`TOKEN_MISSING` 경로, `/mcp`를 호출한다.
   - Phase 7 종료 후 통합 스모크(오케스트레이터): `npm run build` → `node server/dist/index.js`로 `/`, `/api/settings`, `/mcp`의 `tools/list`(10개, SDK 클라이언트 스크립트) 확인 → `docker compose build`·`up`에서 같은 확인 + Verification의 Docker 항목.
6. Phase 8: 계약 격리 Read-back(BE·FE 각각) → frozen contract와 3방향 대조 → 통합 리뷰(scope-reviewer ×2, component-reviewer, a11y-reviewer).
7. Phase 9: push + Draft PR(`master` ← `feature/package-watcher`). Phase 11: 최종 보고.

**롤백 조건:** 모든 변경은 feature 브랜치에만 있다. 계약 변경이 필요하면 구현을 멈추고 계약을 다시 리뷰한다.

---

## Assumptions

Spec의 Assumption 12건(D-11, D-20, D-26~D-35)은 그대로 유지한다. 아래는 이 Plan에서 새로 추가한 것이다. **A-1, A-8, A-9는 Spec의 확정 내용을 바꾼다.**

- [Assumption] A-1 **(Spec 규칙 변경)**: lockfile 귀속을 "같은 디렉터리"에서 **"같은 디렉터리 + 그 lockfile의 workspace로 선언된 `package.json`"**으로 넓힌다 — 근거: 모노레포는 루트에만 lockfile이 있다. Spec 문장 그대로면 workspace의 `package.json`이 모두 range 검사가 되어 오탐이 생긴다. 선언되지 않은 하위 폴더와 lockfile이 없는 repo는 Spec 규칙 그대로다(AC-02 동일).
- [Assumption] A-2: `Finding.htmlUrl`, `Finding.reason` 저장 컬럼을 추가한다 — 근거: 확정 레이아웃의 "GitHub에서 보기" 메뉴와 메일 본문의 사유.
- [Assumption] A-3: `Scan.error`, `Settings.digestTimezone`, `ApiError.details`, `Summary` 타입, 에러 코드 `INVALID_STATE`·`NO_RECIPIENTS`·`SMTP_NOT_CONFIGURED`·`INTERNAL_ERROR`, FE 전용 `NETWORK_ERROR`를 추가한다 — 근거: Spec의 EC-02(`error` 기록), 필드별 오류 표시, Spec에 없는 실패 응답.
- [Assumption] A-4: `Settings.org`는 미설정 시 `null`. 페이지네이션은 offset(`page`/`limit`). 범위 밖 값은 clamp 없이 400 — 근거: Spec API 표의 `page`, `limit`.
- [Assumption] A-5: 저장소는 npm workspaces(`shared`, `server`, `web`). 포트는 운영 3000, 개발 시 web 5173 + proxy — 근거: profile의 루트 `npm run ...` 명령과 `serverUrl`.
- [Assumption] A-6: 작업 브랜치 이름은 `feature/package-watcher` — 근거: profile의 `featureBranchPrefix: feature/`.
- [Assumption] A-7: 첫 자동 스캔은 서버 시작 1분 후. 서버 재시작 시 `running` 스캔은 `failed`. interval 또는 org를 저장하면 `nextScanAt = 저장 시각 + interval`. 일일 요약 발송 실패는 그날 재시도하지 않는다 — 근거: Spec에 첫 실행 시각, 비정상 종료, 재계산 규칙이 없다.
- [Assumption] A-8 **(확정 레이아웃에 추가)**: 대시보드 표와 스캔 이력 표 아래에 페이저(`[이전] N–M / total [다음]`)를 넣는다 — 근거: 확정 레이아웃에는 페이저가 없어서 51번째 검출과 21번째 스캔을 볼 수 없다.
- [Assumption] A-9 **(Spec 통신 계약 초안 변경)**: `DUPLICATE_ENTRY`는 toast가 아니라 Dialog의 `name` 필드 아래에 표시한다. Dialog의 사유도 필수(`사유*`)로 표시한다 — 근거: 입력을 고칠 수 있게 Dialog를 유지해야 한다. `reason`은 Spec에서 필수다.
- [Assumption] A-10: resolve 범위를 넓힌다 — 대상 목록에서 빠진 repo(archived, fork, 삭제), `package.json`이 0개가 된 repo, org 변경 시의 모든 활성 검출을 `resolved`로 바꾼다. 결과: org를 A → B → A로 되돌리면 A의 `ignored` 결정과 알림 이력은 사라지고 검출이 새 `open`으로 다시 생긴다(신규 메일 발송). org는 소문자로 정규화하므로 대소문자만 바꾼 저장은 변경이 아니다 — 근거: 그러지 않으면 그 검출이 open 수와 일일 요약에 영원히 남는다.
- [Assumption] A-11: 스캔과 동시 변경의 규칙 — 스캔은 결과를 종료 시 트랜잭션 1개로 쓴다. 스캔은 `open`↔`ignored`를 바꾸지 않는다. 스캔 중 삭제된 블랙리스트 항목의 결과는 버린다. 스캔 중 org가 바뀌면 그 스캔은 `failed` — 근거: Spec에 경쟁 조건 처리가 없다.
- [Assumption] A-12: 블랙리스트 PUT은 전체 교체다(`versionRange` 키 필수). PUT은 활성 검출의 `reason`을 즉시 갱신한다. `null` 범위끼리도 중복이다 — 근거: 사유만 고치려다 범위가 "모든 버전"으로 넓어지는 사고를 막는다.
- [Assumption] A-13: `package.json`의 spec이 semver range가 아니면(`latest` 같은 dist-tag, `catalog:`, git, url 등) 블랙리스트 범위가 "모든 버전"인 항목에만 일치한다 — 근거: 실제 버전을 알 수 없다. 범위가 있는 항목까지 일치시키면 오탐이 많다. 결과: lockfile이 없는 repo의 `"next": "latest"`는 `next <14` 항목에 검출되지 않는다.
- [Assumption] A-14: GitHub 클라이언트는 `octokit`(Spec D-34와 같음)이고 파일은 blob API로 읽는다. primary rate limit 소진 시 기다리지 않고 남은 repo를 실패로 기록한다. 대상에서 빠진 repo의 resolve는 재확인 후에만 하고, 보이는 repo 수가 직전 스캔의 절반 아래로 줄면 보류한다 — 근거: 1MB 초과 lockfile 지원, lock 장기 점유 방지, 토큰 권한 축소 시 `ignored` 결정 보호.
- [Assumption] A-15: 메일 본문은 최대 200행. server는 `tsup` 번들, shared는 빌드 없는 소스 패키지. SQLite 드라이버는 `better-sqlite3`이고 스모크 실패 시 `node:sqlite`로 바꾼다. 로컬 실행의 listen 주소는 `127.0.0.1` — 근거: 메일 크기 제한, 빌드 단순화, 네이티브 모듈 설치 위험, 인증 없는 API의 LAN 노출 방지.

## Verification (완료 판정)

| 증거 | 명령 / 방법 |
|------|-------------|
| 단위 + 통합 테스트 | `npm test` (shared, server, web) exit 0 |
| ID 추적 | AC-01~14, EC-01~13, CT-01~14의 41개 ID가 각각 테스트 이름에 1개 이상 있다(grep). 최종 보고에 ID → 테스트 파일 표를 넣는다 |
| README | env 표가 `config.ts`의 env 목록과 같다. 실행 방법(bash, PowerShell)과 MCP 연결 방법이 있다 |
| 정적 검사 | `npm run lint`, `npm run typecheck`, `npm run build` 모두 exit 0 |
| 계약 일치 | Phase 8.1 Read-back 3방향 대조 불일치 0건 |
| Docker | `GITHUB_TOKEN=$(gh auth token) docker compose up` 후: `GET /api/settings` 200이고 `githubTokenSource === "env"`, `/`가 HTML, `/mcp`의 `tools/list`가 10개(SDK 클라이언트 스크립트). 블랙리스트 항목 추가 → `docker compose down && up` → 항목이 남아 있다 |
| GUI 4화면 (체크리스트, 모두 확인. 새 volume + `GITHUB_ORG` 미설정에서 시작하고, `ORG_NOT_SET` 확인을 org 저장보다 먼저 한다) | `/`: 카드 4개 + 빈 표 문구. `/blacklist`: 항목 추가 → 표에 표시, 같은 항목 재추가 → `name` 아래 중복 메시지, 삭제. `/settings`: org 저장 → "다음 스캔" 카드 갱신, 잘못된 interval → 필드 오류. `/scans`: org 미설정 상태에서 [지금 스캔] → `ORG_NOT_SET` toast, org 설정 후 [지금 스캔] → running 행 + 버튼 비활성 → 종료 상태로 바뀜 |
| 실제 org 스캔·실제 메일 | 사용자 토큰/SMTP가 있을 때만. 없으면 "미검증"으로 보고 |

---

## 계약 보충 (Phase 6.1 Red 에서 나온 모호한 조항의 확정 — 의미 변경 없음)

Red 에이전트가 "모호함"으로 보고한 조항을 오케스트레이터가 확정한다. 기존 CT 조항의 의미는 바꾸지 않는다.

| # | 조항 | 확정 |
|---|------|------|
| S-1 | `nextScanAt` 격자 공식의 경계 | 결과는 항상 `now`보다 뒤의 시각이다. 공식의 결과가 `now` 이하이면 `interval`을 1번 더 더한다 |
| S-2 | 메일 본문 최대 200행 | 200은 검출 행의 수다(repo 제목 행은 세지 않는다). 넘으면 "외 N건, GUI에서 확인"이고 N = 전체 − 200 |
| S-3 | lockfile 형식 표지 | npm·pnpm·bun = 최상위 `lockfileVersion` 키. yarn = `# yarn lockfile v1` 주석(classic) 또는 `__metadata` 키(berry). 표지가 없으면 예외 |
| S-4 | resolve ② 재확인이 "그 외 오류"일 때 | 검출을 유지하고 그 repo를 `failedRepos`에 넣는다(스캔은 `partial`) |
| S-5 | 테스트 메일의 판정 순서 | `NO_RECIPIENTS` → `SMTP_NOT_CONFIGURED` → 발송 |
| S-6 | 본문이 깨졌고 `:id`도 없는 요청 | `:id` 형식·존재 확인(404)이 본문 검증(400)보다 먼저다 |
| S-7 | `TOKEN_MISSING`의 `message` | "GitHub 토큰이 없습니다. GITHUB_TOKEN 환경 변수를 설정하거나 gh auth login 을 실행한 뒤 서버를 다시 시작하십시오" |
| S-8 | 오류 toast 문구 | 서버 `ApiError.message`를 그대로 표시한다. `INTERNAL_ERROR` = "서버 오류가 발생했습니다", `NETWORK_ERROR` = "서버에 연결할 수 없습니다"(고정) |
| S-9 | 2xx 응답의 parse 실패 | `ApiRequestError.status` = 받은 HTTP status, `code` = `INTERNAL_ERROR` |
| S-10 | "GitHub에서 보기" | `htmlUrl`을 새 탭으로 여는 링크다(`target="_blank"`, `rel="noreferrer"`) |
| S-11 | 설정 화면 첫 로드 실패의 문구 | 공통 GET 오류 문구 "데이터를 불러오지 못했습니다" + [다시 시도] |
| S-12 | 수신자 이메일 형식 검증 시점 | [추가]를 누를 때 검증한다. 잘못된 값은 chip으로 추가하지 않고 필드 오류로 표시한다 |
| S-13 | pnpm v9 의 git 항목, npm v2/v3 의 workspace 디렉터리 항목 | 이름과 버전을 확실히 알 수 없는 항목은 건너뛴다(예외 아님) |
