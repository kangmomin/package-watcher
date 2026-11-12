# Spec: package-watcher (org 블랙리스트 패키지 감시)

- 상태: 구현 준비 완료
- 유형·도메인: 생성 · fullstack
- 작성: 2026-11-12, ready-for-impl 인터뷰 (질문 5회 + 레이아웃 확인 1회)

### 작업 계약
- 대상: 저장소 `C:\workspace\package-watcher`, 브랜치 `master`(빈 저장소, `Initial commit`만 있음). 이슈·설계 문서 없음.
- 기준: 이 Spec이 유일한 기준입니다. 참조 구현은 없습니다(신규 저장소).
- 범위: 주기 스캔, 블랙리스트 매칭(`package.json` + lockfile 4종), SQLite 저장, SMTP 알림(신규 즉시 + 일일 요약), REST API, GUI 4화면(shadcn), MCP 서버(`/mcp`), Dockerfile + compose / 제외: GUI·API·MCP 로그인, 여러 org, 자동 수정 PR, 이메일 외 알림 채널, Playwright E2E, 원격 서버 배포, `bun.lockb` 파싱.
- 완료: AC-01~14와 EC-01~13이 통과합니다. 증거는 단위 테스트(버전 매처, lockfile 파서 4종), API 통합 테스트(GitHub·SMTP mock), 수동 확인(Docker 실행, GUI 4화면, MCP 연결)입니다. README에 실행 방법과 env 목록을 적습니다. 커밋·push·PR 범위는 `start-workflow`에서 정합니다.
- 승인: 이 Spec 내용 확정까지만. 구현·원격 작업은 승인되지 않음.
- 미결: 없음

## 기능 목표
설정한 interval마다 GitHub org의 활성 repo를 스캔하면, 블랙리스트와 일치하는 의존성을 검출로 저장하고 이메일로 알려야 한다. 사용자는 GUI로, AI는 MCP로 같은 데이터를 조회하고 조작할 수 있어야 한다.

## 현재 상황 (As-Is)
| 파일 | 역할 | 수정 필요 |
|------|------|----------|
| (없음) | 빈 저장소 | 모든 파일을 새로 만듭니다 |

### 참조 구현
- 없음.

## 변경 사항 (To-Be)
프로세스 1개, 포트 1개, 컨테이너 1개입니다.

```
[Docker 컨테이너]
 Node 서버 (TypeScript, Hono)
  ├─ /            빌드된 React + shadcn 정적 파일
  ├─ /api/*       REST API
  ├─ /mcp         MCP (Streamable HTTP)
  ├─ 스케줄러      스캔 interval + 일일 요약
  └─ SQLite       /data/package-watcher.db (volume)
        │                    │
   GitHub REST API       SMTP 서버
```

새 구성 요소:
- `server/`: 설정 로더, GitHub 클라이언트, lockfile 파서 4종, 버전 매처, 스캔 서비스, 알림 서비스, 스케줄러, REST 라우트, MCP 서버, SQLite 저장소.
- `web/`: Vite + React + shadcn. 화면 4개.
- `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`.

REST 라우트와 MCP tool은 같은 서비스 함수를 호출합니다. 규칙이 한 곳에만 있어야 하기 때문입니다.

## Feature Matrix
| ID | 사용자 흐름 | 프론트 책임 | 백엔드 책임 | 완료 조건 |
|----|------------|------------|------------|----------|
| F-01 | 자동 스캔과 알림 | 없음 | 스케줄러, 스캔, 검출 저장, 메일 | AC-01~06 |
| F-02 | 검출 결과 조회·무시 | 대시보드 `/` | `GET /api/summary`, `GET/PATCH /api/findings` | AC-07, AC-08 |
| F-03 | 블랙리스트 관리 | `/blacklist` 표 + Dialog | `/api/blacklist` CRUD | AC-09, EC-07~09 |
| F-04 | 스캔 이력·수동 실행 | `/scans` 표 + [지금 스캔] | `GET/POST /api/scans` | AC-10, EC-05, EC-06 |
| F-05 | 설정 변경 | `/settings` 폼 | `GET/PUT /api/settings`, 테스트 메일 | AC-11, AC-12, EC-10, EC-11 |
| F-06 | AI의 MCP 작업 | 없음 | `/mcp` tool | AC-13, AC-14 |

## API
| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/summary` | open 수, ignored 수, 마지막 스캔, 다음 스캔 시각 | 없음 |
| GET | `/api/findings` | 검출 목록. 필터: `status`, `repo`, `package`, `page`, `limit` | 없음 |
| PATCH | `/api/findings/:id` | 상태를 `ignored` 또는 `open`으로 변경 | 없음 |
| GET | `/api/blacklist` | 블랙리스트 목록 | 없음 |
| POST | `/api/blacklist` | 항목 추가 | 없음 |
| PUT | `/api/blacklist/:id` | 항목 수정 | 없음 |
| DELETE | `/api/blacklist/:id` | 항목 삭제 | 없음 |
| GET | `/api/scans` | 스캔 이력 (최신 순) | 없음 |
| GET | `/api/scans/:id` | 스캔 1건 + 실패한 repo 목록 | 없음 |
| POST | `/api/scans` | 수동 스캔 시작 | 없음 |
| GET | `/api/settings` | 설정 + 연결 상태 | 없음 |
| PUT | `/api/settings` | 설정 저장 | 없음 |
| POST | `/api/settings/test-email` | 테스트 메일 발송 | 없음 |
| POST/GET | `/mcp` | MCP Streamable HTTP | 없음 |

### Request
| 대상 | 필드 | 타입 | 필수 | 검증 |
|------|------|------|------|------|
| blacklist POST/PUT | `name` | string | 예 | npm 패키지 이름 규칙 |
| | `versionRange` | string \| null | 아니오 | 유효한 semver range. null = 모든 버전 |
| | `reason` | string | 예 | 1~500자 |
| findings PATCH | `status` | `"ignored"` \| `"open"` | 예 | `resolved`는 입력 불가 |
| settings PUT | `org` | string | 예 | GitHub org 이름 형식 |
| | `scanIntervalHours` | integer | 예 | 1~168 |
| | `digestTime` | string | 예 | `HH:mm`, Asia/Seoul 기준 |
| | `recipients` | string[] | 예 | 각 값이 이메일 형식. 빈 배열 허용 |

### Response
| 대상 | 필드 | 타입 | nullable | 설명 |
|------|------|------|----------|------|
| finding | `id` | integer | 아니오 | |
| | `repo` | string | 아니오 | repo 이름 |
| | `filePath` | string | 아니오 | 검출된 `package.json` 또는 lockfile 경로 |
| | `packageName`, `version` | string | 아니오 | lockfile이 없으면 `version`은 range 문자열 |
| | `dependencyType` | `"direct"` \| `"transitive"` | 아니오 | |
| | `status` | `"open"` \| `"resolved"` \| `"ignored"` | 아니오 | |
| | `blacklistEntryId`, `reason` | integer, string | 아니오 | |
| | `firstSeenAt`, `resolvedAt`, `notifiedAt` | ISO string | 뒤 2개만 예 | |
| scan | `id`, `trigger`, `status` | integer, `"scheduled"`\|`"manual"`, `"running"`\|`"success"`\|`"partial"`\|`"failed"` | 아니오 | |
| | `startedAt`, `finishedAt` | ISO string | `finishedAt`만 예 | |
| | `repoCount`, `newFindingCount` | integer | 아니오 | |
| | `failedRepos` | `{repo, error}[]` | 아니오 | |
| settings | 요청 필드 4개 + `githubTokenSource`, `smtpConfigured` | `"env"`\|`"gh"`\|`"none"`, boolean | 아니오 | 비밀값은 응답에 넣지 않습니다 |
| 오류 | `error.code`, `error.message` | string | 아니오 | 모든 4xx/5xx 공통 |

### MCP tool
| tool | 동작 |
|------|------|
| `list_findings` | `GET /api/findings`와 같음 |
| `set_finding_status` | `PATCH /api/findings/:id`와 같음 |
| `list_blacklist` / `add_blacklist_entry` / `update_blacklist_entry` / `remove_blacklist_entry` | 블랙리스트 CRUD와 같음 |
| `trigger_scan` | `POST /api/scans`와 같음 |
| `list_scans` / `get_scan` | 스캔 이력 조회 |
| `get_settings` | 설정 조회(읽기 전용) |

## 비즈니스 규칙
**스캔 대상**
- org의 repo 중 archived 또는 fork → 건너뜁니다.
- default branch의 파일 트리를 1회 조회합니다. 경로에 `node_modules/`가 있는 파일 → 무시합니다.
- 트리에 `package.json`이 0개 → Node 프로젝트가 아닙니다. 건너뜁니다(실패 아님).

**매칭**
- `package.json`의 `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`를 봅니다.
- lockfile(`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`)의 모든 패키지의 정확한 버전을 봅니다.
- 이름이 일치하고 `versionRange`가 null → 검출.
- 이름이 일치하고 lockfile 버전이 `versionRange`를 만족 → 검출.
- 같은 디렉터리에 lockfile이 없음 → `package.json`의 range가 `versionRange`와 겹치면 검출.
- lockfile에만 있는 패키지 → `transitive`. 같은 디렉터리 `package.json`의 직접 의존성 → `direct`.

**검출 상태**
- 검출의 키 = (repo, 파일 경로, 패키지 이름, 버전, 블랙리스트 항목).
- 키가 새로 나타남 → `open` 검출을 만듭니다.
- 성공적으로 스캔한 repo에서 `open`/`ignored` 검출이 다시 안 보임 → `resolved`.
- 스캔에 실패한 repo의 검출 → 상태를 바꾸지 않습니다.
- `ignored` 검출이 계속 보임 → `ignored` 유지. 메일에 넣지 않습니다.
- `resolved` 검출이 다시 나타남 → 새 `open` 검출을 만듭니다(신규 알림 대상).

**알림**
- 스캔 종료 시 `notifiedAt`이 null인 `open` 검출 ≥ 1건 → 메일 1통. 성공 → `notifiedAt` 기록.
- 발송 실패 → `notifiedAt`은 null 유지. 다음 스캔 종료 시 다시 포함합니다.
- 매일 `digestTime`에 `open` 검출 ≥ 1건 → 요약 메일 1통. 0건 → 보내지 않습니다.

**스케줄**
- 스캔은 동시에 1개만 실행합니다. 자동 스캔 시각에 스캔이 실행 중 → 그 회차를 건너뜁니다.
- 설정 저장 → 스케줄러가 새 값으로 즉시 다시 등록합니다.
- GitHub 토큰: `GITHUB_TOKEN` env → 없으면 `gh auth token` 실행 → 둘 다 없으면 `none`.
- Docker 실행 시에는 컨테이너 안에 `gh` 로그인이 없습니다. `GITHUB_TOKEN=$(gh auth token) docker compose up` 처럼 env로 넣습니다.

## DB 변경
- [ ] `blacklist_entries` (id, name, version_range, reason, created_at, updated_at; unique(name, version_range))
- [ ] `findings` (id, repo, file_path, package_name, version, dependency_type, blacklist_entry_id, status, first_seen_at, last_seen_at, resolved_at, notified_at)
- [ ] `scans` (id, trigger, status, started_at, finished_at, repo_count, new_finding_count, failed_repos JSON, error)
- [ ] `settings` (key, value)
- [ ] 서버 시작 시 스키마를 자동으로 만듭니다.

## Breaking Changes
- 없음 (신규).

## 화면/컴포넌트
- 위치: `/`(대시보드), `/blacklist`, `/scans`, `/settings`. 공통 왼쪽 사이드바.
- 구성: shadcn `Sidebar`, `Card`, `Table`, `Badge`, `Dialog`, `Form`, `DropdownMenu`, `Sonner`(toast).

## 레이아웃 (확정)
```
+------------+---------------------------------------------+
| Package    | [1] 대시보드  /                              |
| Watcher    | +--------+ +--------+ +---------+ +-------+ |
|            | | open   | |ignored | |마지막   | |다음   | |
| > 대시보드 | |  12    | |   3    | |스캔 시각| |스캔   | |
|   블랙리스트| +--------+ +--------+ +---------+ +-------+ |
|   스캔 이력| 상태[open v] repo[검색____] 패키지[검색___]  |
|   설정     | | repo | 파일 경로 | 패키지@버전 | 종류 |   |
|            | |      |           | (직접/전이) | 상태 |⋮ |
|            | | api  | package.. | lodash@4.1 | open |⋮ |
|            | ⋮ 메뉴: 무시 / 다시 열기 / GitHub 에서 보기   |
+------------+---------------------------------------------+

[2] 블랙리스트  /blacklist            [+ 항목 추가]
| 패키지 이름 | 버전 범위   | 사유      | 수정 | 삭제 |
| lodash      | <4.17.21    | 취약점    | [✎]  | [🗑]  |
| evil-pkg    | (모든 버전) | 악성 코드 | [✎]  | [🗑]  |
추가/수정 = Dialog: 이름*, 버전 범위, 사유  [취소][저장]
삭제 = 확인 Dialog

[3] 스캔 이력  /scans                [지금 스캔]
| 시작 시각 | 종류      | 상태    | repo 수 | 신규 | 실패 |
| 11-12 09h | 자동/수동 | success | 42      | 2    | 0    |
| 11-11 09h | 자동      | partial | 42      | 0    | 3    |
행 클릭 = 실패한 repo 와 오류 메시지 펼침
스캔 중 = [지금 스캔] 비활성 + running 배지

[4] 설정  /settings
GitHub org        [my-org________]
스캔 interval(시간)[24]
일일 요약 시각    [09:00] Asia/Seoul
이메일 수신자     [a@x.com ✕] [b@x.com ✕] [+ 추가]
연결 상태: GitHub 토큰 ●  SMTP ●  (값은 env, 읽기 전용)
                                   [테스트 메일] [저장]
```

## 데이터 연동
| API | 사용 필드 | 호출 시점 | 캐시 무효화 |
|-----|----------|----------|------------|
| `GET /api/summary` | 카드 4개 | 대시보드 진입 | 검출 상태 변경 후, 스캔 종료 후 |
| `GET /api/findings` | 표 전체 필드 | 진입, 필터 변경 | `PATCH` 성공 후 |
| `/api/blacklist` | 표 전체 필드 | 진입 | 추가·수정·삭제 성공 후 |
| `GET /api/scans` | 표 전체 필드 | 진입. `running`이 있으면 5초마다 다시 조회 | `POST /api/scans` 성공 후 |
| `/api/settings` | 폼 전체 필드 | 진입 | 저장 성공 후 |

## UI 상태
| 상태 | 표현 |
|------|------|
| loading | 표와 카드에 shadcn `Skeleton` |
| empty | 표 안에 안내 문장 1줄 (예: "검출이 없습니다") |
| success | 표 표시. 변경 작업은 toast로 결과 표시 |
| error | 표 자리에 오류 문장 + [다시 시도]. 변경 작업 실패는 toast에 서버 `error.message` 표시 |

## 통신 계약 (초안)
- 400 `VALIDATION_ERROR` → Dialog/폼의 해당 필드 아래에 메시지.
- 404 `NOT_FOUND` → toast + 목록 다시 조회.
- 409 `SCAN_RUNNING` / `DUPLICATE_ENTRY` → toast.
- 400 `ORG_NOT_SET` / `TOKEN_MISSING` → toast + 설정 화면 링크.
- 502 `SMTP_FAILED` → toast.
- Integration Contract와 `CT-nn` 확정은 `start-workflow` 풀스택 Phase 2에서 합니다.

## 정상 흐름
| ID | 시나리오 | 보장되는 결과 | HTTP |
|----|---------|--------------|------|
| AC-01 | interval이 지나서 자동 스캔이 실행됨 | `scans`에 `trigger=scheduled`, `status=success` 행 1개. `repoCount` = 활성 repo 수 | - |
| AC-02 | repo의 `package.json`에 블랙리스트 패키지(범위 null)가 있음 | `open`, `direct` 검출 1건. `filePath` = 그 `package.json` 경로 | - |
| AC-03 | lockfile 4종 각각에 블랙리스트 범위를 만족하는 전이 의존성이 있음 | 종류마다 `open`, `transitive` 검출 1건. `version` = lockfile의 정확한 버전 | - |
| AC-04 | lockfile의 버전이 블랙리스트 범위 밖임 | 검출 0건 | - |
| AC-05 | 스캔이 신규 `open` 검출 2건으로 끝남 | 모든 수신자에게 메일 1통. 본문에 repo, 파일 경로, 패키지@버전, 사유 2건. 두 검출의 `notifiedAt` 기록 | - |
| AC-06 | `digestTime`에 `open` 3건, `ignored` 1건이 있음 | 요약 메일 1통. 본문에 `open` 3건만 있음 | - |
| AC-07 | `GET /api/findings?status=open` | `open` 검출만 반환. `GET /api/summary`의 open 수와 같음 | 200 |
| AC-08 | `PATCH /api/findings/:id` `{status:"ignored"}` | 응답 `status=ignored`. 다음 요약 메일에 없음 | 200 |
| AC-09 | `POST /api/blacklist` 유효한 값 | 새 항목 반환(`id` 포함). `GET /api/blacklist`에 나타남 | 201 |
| AC-10 | `POST /api/scans` (실행 중인 스캔 없음) | `status=running`, `trigger=manual` 스캔 반환. 종료 후 `success` 또는 `partial` | 202 |
| AC-11 | `PUT /api/settings` `scanIntervalHours=6` | 저장한 값 반환. `GET /api/summary`의 다음 스캔 시각이 6시간 기준으로 바뀜 | 200 |
| AC-12 | `POST /api/settings/test-email` (SMTP 정상) | 수신자에게 테스트 메일 1통 | 200 |
| AC-13 | MCP 클라이언트가 `/mcp`에 연결하고 tool 목록을 요청함 | MCP tool 표의 tool 10개를 반환 | 200 |
| AC-14 | MCP `add_blacklist_entry` 후 `trigger_scan` | 항목이 `GET /api/blacklist`에 나타남. `trigger=manual` 스캔이 시작됨 | - |

## 엣지 케이스
| ID | 케이스 | 기대 동작 | HTTP | 참조 구현 |
|----|--------|----------|------|----------|
| EC-01 | 스캔 중 repo 1개에서 GitHub API 오류 | 그 repo를 건너뜀. 스캔 `partial`. `failedRepos`에 repo와 오류. 그 repo의 기존 검출 상태는 그대로 | - | - |
| EC-02 | 스캔 시작 시 org 목록 조회가 실패(토큰 오류, org 없음) | 스캔 `failed`, `error` 기록. 검출 상태 변경 없음 | - | - |
| EC-03 | 신규 검출 메일의 SMTP 발송 실패 | 검출은 저장됨. `notifiedAt` null. 다음 스캔 종료 시 그 검출을 메일에 다시 포함 | - | - |
| EC-04 | 이전에 `open`이던 검출이 성공한 스캔에서 안 보임 | `resolved`, `resolvedAt` 기록. 메일 없음 | - | - |
| EC-05 | 스캔 실행 중에 `POST /api/scans` | 새 스캔을 만들지 않음. `SCAN_RUNNING` | 409 | - |
| EC-06 | org 미설정 또는 토큰 `none` 상태에서 `POST /api/scans` | 스캔을 만들지 않음. `ORG_NOT_SET` 또는 `TOKEN_MISSING` | 400 | - |
| EC-07 | 블랙리스트에 잘못된 semver range 또는 빈 `name` | 저장하지 않음. `VALIDATION_ERROR` | 400 | - |
| EC-08 | 같은 `name` + `versionRange` 항목을 다시 추가 | 저장하지 않음. `DUPLICATE_ENTRY` | 409 | - |
| EC-09 | 블랙리스트 항목 삭제 | 그 항목의 `open`/`ignored` 검출이 `resolved`로 바뀜 | 204 | - |
| EC-10 | 수신자 0명인 상태에서 신규 검출 발생 | 메일을 보내지 않음. 검출은 저장. `notifiedAt` null 유지 | - | - |
| EC-11 | `PUT /api/settings`에 `scanIntervalHours=0` 또는 잘못된 이메일 | 저장하지 않음. `VALIDATION_ERROR` | 400 | - |
| EC-12 | repo에 `bun.lockb`만 있고 `bun.lock`이 없음 | lockfile 없음으로 처리(`package.json` range 검사). 서버 로그에 경고 | - | - |
| EC-13 | lockfile 또는 `package.json`의 내용을 파싱할 수 없음 | 그 repo를 `failedRepos`에 기록. 스캔 `partial`. 다른 repo는 계속 | - | - |

권한·소유권: 해당 없음. 이유: localhost 전용, 사용자 1명, 로그인 없음(D-11).

## 결정 로그
| ID | 항목 | 결정 | 근거 |
|----|------|------|------|
| D-01 | 유형·도메인 | 생성 · fullstack | 사용자 답(R1: GUI 요구) |
| D-04 | 스택 | TS Node 서버 1개(Hono) + Vite React + shadcn | 사용자 답(R2) |
| D-05 | 검사 깊이 | `package.json` + lockfile | 사용자 답(R1) |
| D-06 | GitHub 인증 | `GITHUB_TOKEN` 우선, `gh auth token` 폴백 | 사용자 답(R2) |
| D-07 | MCP 범위 | 조회 + 스캔 실행 + 블랙리스트 편집 | 사용자 답(R1) |
| D-09 | 실행 위치 | 내 PC의 Docker | 사용자 답(R2) |
| D-10 | GUI 화면 | 대시보드, 블랙리스트, 스캔 이력, 설정 | 사용자 답(R2) |
| D-12 | 블랙리스트 항목 | 이름 + 버전 범위 + 사유 | 사용자 답(R3) |
| D-13 | 저장소 | SQLite | 사용자 답(R3) |
| D-14 | 이메일 | SMTP | 사용자 답(R3) |
| D-15 | 알림 정책 | 신규 즉시 + 미해결 일일 요약 | 사용자 답(R3) |
| D-16 | 검출 상태 | `open` / `resolved` / `ignored` | 사용자 답(R4) |
| D-17 | 스캔 대상 | 활성 repo의 default branch | 사용자 답(R4) |
| D-18 | lockfile | npm + yarn + pnpm + bun | 사용자 답(R4) |
| D-19 | MCP 연결 | Streamable HTTP `/mcp` | 사용자 답(R4) |
| D-21 | GitHub 일부 실패 | 건너뛰고 계속, `partial` | 사용자 답(R5) |
| D-22 | SMTP 실패 | 저장 + 다음 스캔에 재시도 | 사용자 답(R5) |
| D-23 | 기본 주기 | 24시간 / 09:00 KST | 사용자 답(R5) |
| D-24 | 검증 | 단위 + API 통합 + 수동 | 사용자 답(R5) |
| D-25 | 레이아웃 | 위 ASCII로 확정 | 사용자 답(레이아웃 확인) |

## Assumption
- [Assumption] D-11: GUI·API·MCP에 로그인이 없습니다. compose는 포트를 `127.0.0.1`에만 엽니다 — 근거: "내 PC의 Docker"(R2).
- [Assumption] D-20: `bun.lock`(텍스트)만 파싱합니다. `bun.lockb`는 건너뜁니다(EC-12) — 근거: 바이너리 형식은 `bun` 실행 파일이 있어야 읽습니다.
- [Assumption] D-26: org는 1개입니다 — 근거: 요청 문장 "특정 github 의 org".
- [Assumption] D-27: 비밀값(GitHub 토큰, SMTP host/port/user/pass/from)은 env로만 받습니다. GUI는 연결 상태만 표시합니다 — 근거: 비밀값을 DB와 API 응답에 두지 않기 위함.
- [Assumption] D-28: 설정(org, interval, 요약 시각, 수신자)은 SQLite에 저장합니다. 첫 실행 때 env 값(`GITHUB_ORG` 등)으로 초기값을 넣습니다 — 근거: 설정 화면 요구(R2).
- [Assumption] D-29: 검출의 키는 (repo, 파일 경로, 패키지 이름, 버전, 블랙리스트 항목)입니다. `resolved` 후 다시 나타나면 새 검출입니다 — 근거: "신규 즉시" 알림(R3)을 판정하려면 키가 필요합니다.
- [Assumption] D-30: lockfile이 없으면 `package.json`의 range와 블랙리스트 range가 겹칠 때 검출합니다 — 근거: 정확한 버전이 없어서 놓치는 것보다 알리는 쪽이 안전합니다.
- [Assumption] D-31: 블랙리스트 항목을 삭제하면 그 항목의 검출은 `resolved`가 됩니다(EC-09). 항목을 추가·수정해도 스캔을 자동으로 실행하지 않습니다. 다음 스캔이 반영합니다 — 근거: 가장 단순한 동작.
- [Assumption] D-32: 스캔은 동시에 1개입니다. 겹치는 자동 회차는 건너뜁니다. 수동 요청은 409입니다(EC-05) — 근거: GitHub rate limit과 중복 검출 방지.
- [Assumption] D-33: MCP tool은 설정을 읽기만 합니다(`get_settings`). 검출의 `ignored` 변경은 MCP로 가능합니다 — 근거: MCP 범위 답(R1)에 설정 편집이 없습니다. 검출 상태 질문(R4)의 선택지에 "사람 또는 AI"가 있습니다.
- [Assumption] D-34: 라이브러리는 Hono, `@modelcontextprotocol/sdk`, `better-sqlite3`, `nodemailer`, `semver`, `octokit`, TanStack Query, Vitest입니다. 포트는 3000입니다. 구현 계획 단계에서 바꿀 수 있습니다 — 근거: 확정한 스택(D-04)의 일반적인 조합.
- [Assumption] D-35: 요약 시각의 타임존은 Asia/Seoul로 고정합니다 — 근거: 기본 주기 답(R5) "09:00 KST".

## 미결
- 없음

## Plan 승인으로 바뀐 내용 (2026-11-12)

사용자가 구현 Plan(`docs/20261112-package-watcher-plan.md`)을 승인했다. 그 Plan의 `## Assumptions`(A-1 ~ A-15)와 `## Integration Contract (v1.3)`는 이 Spec의 위 내용보다 우선한다. 이 Spec의 본문과 다른 곳은 아래와 같다.

| 항목 | 이 Spec의 원래 내용 | 승인된 내용 |
|------|---------------------|-------------|
| A-1 | lockfile 귀속 = "같은 디렉터리" | "같은 디렉터리 + 그 lockfile의 workspace로 선언된 `package.json`" |
| A-2, A-3 | 응답 필드 표 | `Finding.htmlUrl`·`reason`(저장), `Scan.error`, `Settings.digestTimezone`, `Summary` 타입, `ApiError.details`, 에러 코드 4개 추가 |
| A-8 | 확정 레이아웃에 페이저 없음 | 대시보드 표와 스캔 이력 표 아래에 페이저 추가 |
| A-9 | `DUPLICATE_ENTRY` = toast | Dialog의 이름 필드 아래에 표시. 사유도 필수 표시 |
| A-10 | resolve = 성공한 repo에서 안 보인 검출 | 대상에서 빠진 repo, `package.json`이 0개가 된 repo, org 변경 시의 모든 활성 검출도 `resolved` |
| A-11 | (없음) | 스캔은 결과를 종료 시 트랜잭션 1개로 쓴다. 스캔 중 org 변경 → 그 스캔은 `failed` |
| A-12 | PUT = POST와 같음 | PUT은 전체 교체(`versionRange` 키 필수). 활성 검출의 사유를 즉시 갱신 |
| A-13 | lockfile 없으면 range가 겹칠 때 검출 (D-30) | semver range가 아닌 spec(`latest` 등)은 "모든 버전" 항목에만 일치 |
| A-14 | (없음) | 파일은 blob API로 읽는다. rate limit 소진 시 기다리지 않는다. repo 수가 절반 아래로 줄면 resolve를 보류 |
| A-15 | D-34의 라이브러리 목록 | server는 `tsup` 번들, shared는 소스 패키지, 메일 본문 최대 200행, 로컬 listen 주소 `127.0.0.1` |

추적 ID: 이 Spec의 AC-01~14, EC-01~13에 더해 Plan의 CT-01~14가 완료 조건이다.
