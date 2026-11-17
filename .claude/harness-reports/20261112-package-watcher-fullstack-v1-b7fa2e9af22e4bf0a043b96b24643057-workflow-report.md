---
run_id: "b7fa2e9af22e4bf0a043b96b24643057"
type: "report"
status: "active"
updated: "2026-11-12"
archive_status: "OK"
archive_diagnostics: []
result_summary: {"unit": [{"domain": "be", "kind": "unit", "phase": "11", "iteration": 3, "verdict": "PASS", "terminal_state": "DONE", "regression_count": 0, "tested_tree": {"head": "9f00f46399d7b6c1c3bcfe847928c5d9eb2dcc8e", "content_sha256": "f14e4870e4eca545b3bcb842d1c1f3f7ff6ad34cf6944a7d67cbfe77cffc2678", "fingerprint_version": 2, "head_sensitive": false}}, {"domain": "fe", "kind": "unit", "phase": "11", "iteration": 3, "verdict": "PASS", "terminal_state": "DONE", "regression_count": 0, "tested_tree": {"head": "9f00f46399d7b6c1c3bcfe847928c5d9eb2dcc8e", "content_sha256": "f14e4870e4eca545b3bcb842d1c1f3f7ff6ad34cf6944a7d67cbfe77cffc2678", "fingerprint_version": 2, "head_sensitive": false}}], "integration": [], "e2e": [], "readback": [{"domain": "fs", "kind": "readback", "phase": "8.1", "iteration": 2, "verdict": "PASS", "terminal_state": "DONE", "tested_tree": {"head": "9f00f46399d7b6c1c3bcfe847928c5d9eb2dcc8e", "content_sha256": "f14e4870e4eca545b3bcb842d1c1f3f7ff6ad34cf6944a7d67cbfe77cffc2678", "fingerprint_version": 2, "head_sensitive": false}}], "scope": []}
created: "2026-11-12"
title: "package-watcher-fullstack-v1 \uc6cc\ud06c\ud50c\ub85c\uc6b0 \ub9ac\ud3ec\ud2b8"
tags: ["workflow-report", "harness", "package-watcher-fullstack-v1"]
scope_review_history: []
result_schema_version: 1
tested_tree: {"head": "9f00f46399d7b6c1c3bcfe847928c5d9eb2dcc8e", "content_sha256": "f14e4870e4eca545b3bcb842d1c1f3f7ff6ad34cf6944a7d67cbfe77cffc2678", "fingerprint_version": 2, "head_sensitive": false}
terminal_state: "DONE"
tier: "standard(\uace0\uc815)"
regression_count: 0
touched_paths: [".conventions.json", ".dockerignore", ".env.example", ".gitattributes", ".gitignore", ".prettierrc", "Dockerfile", "docker-compose.yml", "eslint.config.js", "package-lock.json", "package.json", "server/package.json", "server/src/app.ts", "server/src/clock.ts", "server/src/config.ts", "server/src/db/index.ts", "server/src/db/schema.ts", "server/src/errors.ts", "server/src/github/client.ts", "server/src/index.ts", "server/src/lockfiles/__fixtures__/index.ts", "server/src/lockfiles/bun.ts", "server/src/lockfiles/common.ts", "server/src/lockfiles/index.ts", "server/src/lockfiles/npm.ts", "server/src/lockfiles/pnpm.ts", "server/src/lockfiles/yarn.ts", "server/src/logger.ts", "server/src/matcher.ts", "server/src/mcp/server.ts", "server/src/repositories/blacklist.ts", "server/src/repositories/findings.ts", "server/src/repositories/index.ts", "server/src/repositories/scans.ts", "server/src/repositories/settings.ts", "server/src/routes/blacklist.ts", "server/src/routes/errors.ts", "server/src/routes/findings.ts", "server/src/routes/scans.ts", "server/src/routes/settings.ts", "server/src/scheduler.ts", "server/src/services/blacklistService.ts", "server/src/services/common.ts", "server/src/services/findingService.ts", "server/src/services/index.ts", "server/src/services/notifier.ts", "server/src/services/scanService.ts", "server/src/services/settingsService.ts", "server/src/test/assertions.ts", "server/src/test/clock.ts", "server/src/test/fetchMock.ts", "server/src/test/github.ts", "server/src/test/logger.ts", "server/src/test/mailer.ts", "server/src/test/mcp.ts", "server/src/test/repoFixtures.ts", "server/src/test/testApp.ts", "server/src/workspaces.ts", "server/tsconfig.json", "server/tsup.config.ts", "server/vitest.config.ts", "shared/package.json", "shared/src/contract.ts", "shared/src/fixtures.ts", "shared/src/index.ts", "shared/tsconfig.json", "tsconfig.base.json", "web/components.json", "web/index.html", "web/package.json", "web/src/app/App.tsx", "web/src/app/AppLayout.tsx", "web/src/app/router.tsx", "web/src/components/DataState.tsx", "web/src/components/LoadError.tsx", "web/src/components/LoadingState.tsx", "web/src/components/Pager.tsx", "web/src/components/RowHeaderCell.tsx", "web/src/components/StatusBadge.tsx", "web/src/components/ui/alert-dialog.tsx", "web/src/components/ui/badge.tsx", "web/src/components/ui/button.tsx", "web/src/components/ui/card.tsx", "web/src/components/ui/dialog.tsx", "web/src/components/ui/dropdown-menu.tsx", "web/src/components/ui/field.tsx", "web/src/components/ui/input.tsx", "web/src/components/ui/label.tsx", "web/src/components/ui/select.tsx", "web/src/components/ui/separator.tsx", "web/src/components/ui/sheet.tsx", "web/src/components/ui/sidebar.tsx", "web/src/components/ui/skeleton.tsx", "web/src/components/ui/sonner.tsx", "web/src/components/ui/table.tsx", "web/src/components/ui/textarea.tsx", "web/src/components/ui/tooltip.tsx", "web/src/features/blacklist/BlacklistDialog.tsx", "web/src/features/blacklist/BlacklistPage.tsx", "web/src/features/blacklist/BlacklistTable.tsx", "web/src/features/blacklist/DeleteConfirm.tsx", "web/src/features/blacklist/hooks.ts", "web/src/features/findings/DashboardPage.tsx", "web/src/features/findings/FindingsFilters.tsx", "web/src/features/findings/FindingsTable.tsx", "web/src/features/findings/SummaryCards.tsx", "web/src/features/findings/hooks.ts", "web/src/features/scans/ScanNowButton.tsx", "web/src/features/scans/ScansPage.tsx", "web/src/features/scans/ScansTable.tsx", "web/src/features/scans/hooks.ts", "web/src/features/settings/ConnectionStatus.tsx", "web/src/features/settings/RecipientsInput.tsx", "web/src/features/settings/SettingsForm.tsx", "web/src/features/settings/SettingsPage.tsx", "web/src/features/settings/hooks.ts", "web/src/features/summary/useSummary.ts", "web/src/hooks/use-mobile.ts", "web/src/index.css", "web/src/lib/api.ts", "web/src/lib/errors.ts", "web/src/lib/form.ts", "web/src/lib/format.ts", "web/src/lib/queryClient.ts", "web/src/lib/queryKeys.ts", "web/src/lib/queryState.ts", "web/src/lib/utils.ts", "web/src/main.tsx", "web/src/test/LocationProbe.tsx", "web/src/test/fetchMock.ts", "web/src/test/polyfills.ts", "web/src/test/render.tsx", "web/src/test/setup.ts", "web/src/test/ui.ts", "web/tsconfig.json", "web/vite.config.ts"]
---
## 📋 Task Report: package-watcher (org 블랙리스트 패키지 감시) — 풀스택 v1

- 저장소: `C:\workspace\package-watcher` · 브랜치 `feature/package-watcher` · Draft PR https://github.com/kangmomin/package-watcher/pull/1 (base `master`)
- RUN_ID: `b7fa2e9af22e4bf0a043b96b24643057` · START_SHA `b66bf01` → HEAD `9f00f46` (커밋 10개)
- 기준 문서: `docs/20261112-package-watcher-spec.md`, `docs/20261112-package-watcher-plan.md`

### 1. Pre-Review (Plan)
- Codex 모드: none · 모델: 기본 (Codex 미사용. 모든 리뷰는 Claude 패널과 Claude 리뷰 에이전트가 수행했다)
- Codex Feedback: 해당 없음 (`codexMode: none` — be·fe profile)
- Claude Feedback:
  - Phase 3 계약 리뷰 4회(BE advisor, FE advisor, 교차 리뷰 A·B): 모두 `CONCERN`, 지적 33건
  - Phase 4.4 Plan 검증 3회(Logic / Architecture / Edge Cases 패널): 1회차 `REJECT` ×3(지적 19건) → 2회차 `APPROVE`·`APPROVE`·`CONCERN` → 3회차 `APPROVE`
  - 3회차는 `CONCERN`을 낸 Edge Cases 리뷰어 1명만 다시 확인했다(나머지 2명은 2회차 `APPROVE` 유지)
- Refinement: 계약 v1 → v1.3. 주요 보완 = Docker 토큰 전달과 데이터 경로, 의존성 설치 주체(스캐폴딩 게이트), blob API(1MB 초과 lockfile), 파서 정규화 규칙, 스캔 종료 트랜잭션과 예외 경로, resolve 범위와 안전장치. 기각한 지적 0건.

### 2. Implementation Details
- Assumptions:
  - Plan의 A-1 ~ A-15 (사용자가 Plan 승인으로 확정). Spec과 달라진 곳은 Spec 파일 끝의 표에 있다.
  - 계약 보충 S-1 ~ S-13 (Red 단계의 모호 조항 확정), S-14 ~ S-20 (Phase 8.2 리뷰 반영) — 오케스트레이터가 정했고 Plan 문서 끝에 기록했다. 의미가 바뀌는 조항은 없다고 판단했다.
  - 코드의 `[Assumption]` 9건은 Assumption Gate에서 사용자가 모두 승인했고 태그를 지웠다.
- Key Changes:
  - `shared/`: Integration Contract의 zod 스키마, fixture, 계약 테스트
  - `server/`: lockfile 파서 4종, 매처, workspace 귀속, GitHub 클라이언트, 스캔·알림·스케줄러, REST 13개, MCP tool 10개, SQLite
  - `web/`: 화면 4개(대시보드, 블랙리스트, 스캔 이력, 설정), api 클라이언트, 페이저, 접근성 보완
  - 배포: `Dockerfile`(multi-stage), `docker-compose.yml`, `README.md`, `.env.example`
- 계획과 달라진 것:
  - eslint 10 → 9.39 (`eslint-plugin-jsx-a11y`가 10 미지원), TypeScript ~6.0.3 (`typescript-eslint`가 <6.1 요구)
  - shadcn `form` → `field` (레지스트리에 `form` 없음). `@hookform/resolvers`는 쓰지 않아서 제거
  - Dockerfile: `better-sqlite3`가 컨테이너에서 소스 빌드를 요구해서 build·prod-deps stage에 빌드 도구를 넣었다(Plan의 대안 1)
  - Dockerfile·compose·.dockerignore는 스모크를 위해 오케스트레이터가 먼저 작성했다(이후 BE 소유)
- 프로세스 관찰:
  - Agent의 worktree가 현재 HEAD가 아니라 `b66bf01`에서 만들어졌다. 각 에이전트가 자기 worktree 브랜치에서 `git merge --ff-only`로 맞췄다
  - Phase 8.2 수정은 worktree 없이 부모 checkout에서 BE → FE 순서로 1명씩 실행했다
  - OCR 보조 입력은 사용하지 못했다(OCR 실행 파일 미설치). 기존 리뷰로 진행했다
  - simplify-loop는 Workflow tool이 없어 빌트인 `/simplify` 반복 경로로 실행됐다. E2E 락 스크립트는 Windows에 `fcntl`이 없어 `--no-lock`으로 실행됐다

### 3. Final Convention Review
- Layer Analysis:
  - 서버: routes → services → repositories 계층. REST와 MCP가 같은 서비스 함수를 쓴다. SQL은 모두 바인딩 파라미터
  - 웹: feature-based. 데이터 hooks와 표시 컴포넌트 분리. 응답 모양은 `@pw/shared`만 정의한다
  - convention-check: BE 위배 75건 중 9건 수정(나머지 = 최초 도입 의존성 13건, 내부 모듈의 문서 주석 53건 — 사유 기록 후 유지). FE 위배 18건 중 14건 수정(예외 2건, ErrorBoundary·코드 스플리팅 미적용 — 사유 기록)
- Simplicity Check:
  - 서버 단순화 23건(중복 통일, 스캔의 트리 1회 순회). 동작 변경은 boolean env 해석 1건
  - 웹 단순화 17건(첫 로드 오류 판정, 빈 페이지 이동, 폼 오류 반영의 중복 제거)

### 4. 테스트 / 회귀
- **BE 테스트 판정**: PASS — regression 0 / new_red 0 / flaky 0 / pre_existing 0(범위 밖). 199개 통과
- **FE 테스트 판정**: PASS — regression 0 / new_red 0 / flaky 0 / pre_existing 0(범위 밖). 135개 통과
- 공용 계약 테스트(shared): 32개 통과
- **계약 커버리지**: `CT-nn` 중 테스트로 고정된 비율 14/14. AC 14/14, EC 13/13 (테스트 이름의 ID 접두를 grep으로 확인)
- 정적 검사: typecheck, lint, build 모두 exit 0
- 계약 격리 Read-back: 3방향 대조 불일치 0건 (공통 사실 34개 × 3축, 서버 전용 사실 26개는 BE↔계약만 — FE는 `response.ok`만 확인하므로 해당 없음)
- Phase 8.2 리뷰: BE scope `WARN`(4건 수정), FE scope `FAIL` → 수정 후 재검증 `WARN`(새 FAIL 없음), 컴포넌트 `CONCERN`(2건 수정), 접근성 `WARN`(8건 반영)
- 백엔드 E2E(실제 HTTP, 77개 케이스): 서버 결함 0건, 판정 `WARN` — EC-01, 03, 04, 09, 10, 12, 13은 실제 repo·SMTP가 필요해서 E2E로 실행하지 못했다(통합 테스트가 검증)
- 통합 스모크: 빌드 서버(설정 API, 화면, SPA 폴백, `/api` 404, MCP tool 10개), Docker compose(`githubTokenSource: env`, 재시작 후 데이터 유지, uid 1000)
- 미검증: 실제 GitHub org 스캔, 실제 SMTP 발송, 브라우저에서의 화면 4개 수동 확인(Plan Verification의 GUI 체크리스트), Playwright E2E(범위 제외)

### 4.1 미해결 항목 (유저 결정 필요)
없음.

- 결정 완료: 코드의 가정 9건 승인(태그 제거), 메일 발송 중 lock 구간은 현재 동작 유지(README "알려진 한계"에 기록)
- 참고(결정 불필요, 알림만):
  - 운영 JS 번들 약 700 kB(Vite 권고 500 kB 초과). 화면 지연 로딩은 이득이 작아 적용하지 않았다
  - ErrorBoundary 없음(추가하면 계약에 없는 오류 화면이 생긴다)
  - 커밋 `aff394d`의 메시지 본문에 `[Assumption]`이라는 단어가 있다(주석을 달았다는 설명이고 미해결 가정이 아니다)
  - 후속 작업: 블랙리스트 동적 등록·관리 4가지(여러 언어, 취약점 DB, 규칙 확장, 일괄 관리) — 이 PR 이후 별도 Spec/PR

### 5. Status
- Verification: 테스트 366개 통과, typecheck·lint·build exit 0, 계약 Read-back 불일치 0건, Docker 스모크 통과. PR 전제 조건 검사 `READY`, Assumption Gate 통과
- 원격: `feature/package-watcher` push 완료, Draft PR #1 생성
- Cleanup: 에이전트 worktree 5개와 그 브랜치 제거, 스모크용 컨테이너·volume·이미지 제거, E2E 임시 서버와 데이터 폴더 제거. Docker Desktop은 실행 중인 채로 두었다(원래 꺼져 있었다)

### 6. 회고
- SKIPPED:REFLECT_NOT_REQUESTED

<!-- workflow-archive: appendix -->

## 부록 A: 실행 요약

- run_id: `b7fa2e9af22e4bf0a043b96b24643057` · MODE: fs · 상태 파일: `C:\Users\minmo\AppData\Local\Temp\harness-workflow-edo93d4d\workflow-state.md`
- 시작 커밋: b66bf01721e69cc6c64ed217b126a25972fdec57 · 종료 커밋: 9f00f46399d7b6c1c3bcfe847928c5d9eb2dcc8e
- Flags: MODE: fs / HARD_MODE: false / PUBLISH_POLICY: pr / ROUTE_TARGET: fs / TDD: true / REFLECT: false / TIER: standard(고정) / CODEX: none / CODEX_MODELS: N/A / RUN_ID: b7fa2e9af22e4bf0a043b96b24643057 / START_SHA: b66bf01721e69cc6c64ed217b126a25972fdec57
- 검증 티어: standard(고정)
- 승격 이력: 기록 없음
- 최종 테스트 판정: be Phase 11 PASS · regression: 0; fe Phase 11 PASS · regression: 0
- E2E: 기록 없음
- Read-back: fs Phase 8.1 PASS
- Scope: 기록 없음
- 산출물: workflow-report: (아카이브 후 기록)
- 미결 질문: 기록 없음(impl-notes 미전달)
- touched_paths: 136개 (frontmatter)

커밋 목록 (`b66bf01721e69cc6c64ed217b126a25972fdec57..HEAD`):

- 9f00f46 Doc: 승인된 가정의 태그 정리와 알려진 한계 추가
- bd59325 Fix: 통합 리뷰에서 나온 웹 결함과 접근성 문제 수정
- 411ae1a Fix: 통합 리뷰에서 나온 서버 결함 4건 수정
- 4f0a8cf Refactor: 웹 코드 단순화와 컨벤션 정리 (품질 루프)
- aff394d Refactor: 서버 코드 단순화와 컨벤션 정리 (품질 루프)
- 268a6df Add: package-watcher 웹 GUI 구현 (대시보드, 블랙리스트, 스캔 이력, 설정)
- b5a3e09 Add: package-watcher 서버 구현 (스캔, 알림, REST API, MCP)
- 27541d9 Test: package-watcher — 계약 기반 실패 테스트 선작성 (Red)
- d33592f Chore: 줄바꿈을 LF 로 고정 (.gitattributes)
- fcddc86 Chore: 프로젝트 골격과 공용 계약(shared) 추가

## 부록 B: 상태 파일 전문

## Fullstack Workflow State

### Run
- CWD: C:\workspace\package-watcher
- MODE: fs
- RUN_ID: b7fa2e9af22e4bf0a043b96b24643057
- RUN_DIR: C:\Users\minmo\AppData\Local\Temp\harness-workflow-edo93d4d

### Flags
- MODE: fs
- HARD_MODE: false
- PUBLISH_POLICY: pr
- ROUTE_TARGET: fs
- TDD: true
- REFLECT: false
- TIER: standard(고정)
- CODEX: none
- CODEX_MODELS: N/A
- RUN_ID: b7fa2e9af22e4bf0a043b96b24643057
- START_SHA: b66bf01721e69cc6c64ed217b126a25972fdec57

### Spec
- 요구 기준: C:\workspace\package-watcher\docs\20261112-package-watcher-spec.md
- 승인된 통합 Plan(작업 계약, Feature Matrix, Integration Contract v1.3, BE/FE/공용 Plan, Assumptions, Verification) 전문:
  C:\Users\minmo\AppData\Local\Temp\harness-workflow-edo93d4d\plan-contract.md
- 사용자 승인: ExitPlanMode 승인(2026-11-12). 원격 정책 pr. GitHub repo kangmomin/package-watcher(비공개)는 사용자 지시로 생성.

### Feature Matrix
plan-contract.md "## Feature Matrix" (F-01~F-06)

### Integration Contract
plan-contract.md "## Integration Contract (v1.3 …)" (CT-01~CT-14) — frozen

### Codex Runtime
- 상태: N/A

### Current Phase
Phase 11 - 완료

### Phase Assignments
| Phase | Agent | Model | Effort | Status |
|-------|-------|-------|--------|--------|
| 1 | orchestrator (Spec 재사용, request 생략) | 현재 세션 | 현재 세션 | DONE |
| 2 | orchestrator | 현재 세션 | 현재 세션 | DONE |
| 3 | contract review agents ×4 | opus | high | DONE |
| 4 | orchestrator + Claude 패널 | opus | high | DONE |
| 5 | orchestrator | 현재 세션 | 현재 세션 | DONE |
| 6.0 | orchestrator (스캐폴딩 게이트) | 현재 세션 | 현재 세션 | DONE |
| 6.1 | BE Red + FE Red (general-purpose, opus/high) + 오케스트레이터 배리어 | opus | high | DONE |
| 6.2 | BE workflow-implementer + FE workflow-implementer | opus | high | DONE |
| 7 | BE/FE quality runners (general-purpose) | opus | high | DONE |
| 8 | Read-back ×2(opus) + scope-reviewer ×2(opus) + component·a11y(sonnet) + 수정 implementer ×2 | opus/sonnet | high/medium | DONE |
| 9 | orchestrator (Assumption Gate → push → Draft PR) | 현재 세션 | 현재 세션 | DONE |
| 10 | workflow-reflection | - | - | SKIPPED:REFLECT_NOT_REQUESTED |
| 11 | orchestrator | 현재 세션 | 현재 세션 | DONE |

### Remaining Phases
없음

### Test Baseline (도메인별)
- 커밋: b66bf01721e69cc6c64ed217b126a25972fdec57   |   수집 Phase: 5 (자율 실행 진입 전)

| 도메인 | suite | 명령 | 러너 완주 | 통과 | 실패 | 실패 목록 |
|--------|-------|------|----------|------|------|-----------|
| BE | unit | npm test | N (package.json 없음 — 신규 저장소, 기존 테스트 0개) | 0 | 0 | 없음 |
| FE | unit | npm test | N (package.json 없음 — 신규 저장소, 기존 테스트 0개) | 0 | 0 | 없음 |

- 판정: 기존 테스트가 없으므로 `pre_existing`/`regression` 대상 없음. 모든 실패는 `new_red`로 추적한다.
- TDD 적용 판정: BE 활성, FE 활성 (테스트 인프라는 Phase 6.0 스캐폴딩에서 만든다. 계약에 CT 14개가 있다).

### TDD Test Map (도메인별)
Red 커밋 27541d9. 모든 테스트 이름에 근거 ID 접두가 있다(`[AC-05] …`). 상세 매핑은 테스트 이름 grep 이 정본이다.

| 근거 ID | 도메인 | 테스트 파일 | Red | Green |
|---------|--------|-------------|-----|-------|
| CT-01, CT-12 | 공용 | shared/src/contract.test.ts (32개) | already_satisfied (스키마가 6.0 에서 작성됨) | PASS |
| AC-01~14, EC-01~13, CT-02~14 (40개 ID) | BE | server/src/**/*.test.ts — 18개 파일, 176개 | red_assertion ×176 | - |
| CT-02~10, CT-12, CT-13 (+AC-07~12, EC-05~09, EC-11) | FE | web/src/**/*.test.{ts,tsx} — 9개 파일, 117개 | red_assertion ×117 | - |
| CT-11, CT-14 | FE | — | N/A(영향 없음 — MCP 와 스케줄 계산은 화면이 소비하지 않는다) | - |

### Overlay Handoff
없음 (minmos-harness 설치됨, 사용자 결정으로 적용 안 함. hyeondongs-harness 미설치)

### Backend Plan
plan-contract.md "## Backend Plan"

### Frontend Plan
plan-contract.md "## Frontend Plan"

### Shared Ownership
plan-contract.md "### Ownership" — shared/**, 루트 설정, docs/** = 오케스트레이터. server/** + 배포 파일 = BE. web/** = FE.

### Assumptions
plan-contract.md "## Assumptions" (A-1 ~ A-15) + Spec의 D-11, D-20, D-26~D-35

### Plan Verification Log
plan-contract.md "### Plan Verification Log" — Total Iterations 3 / Convergence PROCEED / 잔존 이슈 없음

### Phase Results
- Phase 1~4: DONE. 계약 리뷰 4회(CONCERN ×4, 지적 33건 반영), Plan 검증 3회(REJECT → CONCERN → APPROVE).
- Phase 5: 브랜치 feature/package-watcher 생성 (START_SHA b66bf01).
- Phase 6.0: DONE. 커밋 fcddc86, d33592f. 스모크 3개 통과(better-sqlite3 :memory:, vite build, multi-stage docker build + 컨테이너 응답). shared 계약 테스트 32개 통과, 루트 typecheck/lint/build exit 0.
  - 계획과 다른 점: eslint 10 → 9.39 (eslint-plugin-jsx-a11y 가 10 미지원). TypeScript ~6.0.3 (typescript-eslint 가 <6.1 요구). shadcn `form` 대신 `field` 컴포넌트(레지스트리에 form 없음). Dockerfile 은 대안 1 적용(build·prod-deps stage 에 python3 make g++), prod-deps 의 /app 전체를 runtime 으로 복사(semver 가 server/node_modules 에 설치됨). Dockerfile·compose·.dockerignore 는 스모크를 위해 오케스트레이터가 먼저 작성(이후 BE owner).
- Phase 6.1: DONE. BE 176개·FE 117개 모두 red_assertion(미구현 스텁). 부모에서 typecheck/lint exit 0 확인. 범위 검사: BE 변경 62개 모두 server/src, FE 변경 44개 모두 web/src. 모호 조항 13개를 docs plan 의 "계약 보충"(S-1~S-13)으로 확정. Red 커밋 27541d9.
- Phase 6.2: DONE. BE 185개·FE 117개 통과(FE [TestConflict] 4건 = 테스트 준비 코드의 toast 잔존 → setup.ts 에 toast.dismiss() 추가, 계약 무관). 커밋 b5a3e09, 268a6df.
- Phase 7: DONE. BE 루프 3회차 탈출(단순화 23, 컨벤션 9, E2E 77케이스 서버 결함 0, E2E 판정 WARN — 실제 repo/SMTP 필요한 EC 7건 미실행), 커밋 aff394d. FE 루프 3회차 탈출(단순화 17, 컨벤션 14, E2E SKIPPED:DISABLED), 커밋 4f0a8cf. OCR 입력: unavailable(OCR executable not installed). 통합 스모크(빌드 서버 + Docker compose) PASS.
- Phase 8.1: DONE. 3방향 대조 — 공통 사실 34개 불일치 0건, 서버 전용 26개는 be:contract 0건·FE 해당 없음(compare-common.json / compare-input.json).
- Phase 8.2: DONE. BE scope WARN(4건 수정, 커밋 411ae1a, [TestConflict] 1건 = S-15 와 충돌한 fixture 값 → 오케스트레이터가 수정). FE scope FAIL(CT-02 빈 페이지 이동) → 수정(커밋 bd59325) → 같은 리뷰어 재검증 WARN(새 FAIL 없음). component CONCERN, a11y WARN 반영. 계약 보충 S-14~S-20.
- Phase 9: DONE. workflow_policy fullstack = READY. Assumption Gate 9건 승인. push + Draft PR https://github.com/kangmomin/package-watcher/pull/1
- Phase 11: DONE.
  - 관찰: Agent worktree 가 현재 HEAD 가 아니라 b66bf01 에서 만들어졌다. 두 에이전트가 자기 worktree 브랜치에서 `git merge --ff-only d33592f` 로 맞췄다(커밋 생성 없음).
  - 병렬 writer 격리: Agent 의 worktree 격리 사용. 종료 후 오케스트레이터가 worktree 의 변경 경로가 소유 범위(server/** 또는 web/**) 안인지 확인하고 부모에 반영.

### Final Decisions
| 항목 | 결정 | 시각 |
|------|------|------|
| minmos-harness 오버레이 | 적용 안 함 | 2026-11-12 Pre-flight |
| 원격 정책 | remote 추가 후 pr (repo kangmomin/package-watcher 비공개 생성 지시) | 2026-11-12 Pre-flight |
| 통합 Plan (계약 v1.3, A-1~A-15) | 승인 (ExitPlanMode) | 2026-11-12 Phase 4.4 |
| 후속 작업: 동적 블랙리스트 4가지 | 이 PR 이후 별도 Spec/PR | 2026-11-12 Phase 7 중 |
| 코드의 [Assumption] 9건 | 모두 승인 — 태그 제거 (커밋 9f00f46) | 2026-11-12 Phase 9 Gate |
| 메일 발송 중 scan lock 구간의 409 | 현재 동작 유지, README 알려진 한계에 기록 | 2026-11-12 Phase 9 Gate |

### Artifacts
- workflow-report: (아카이브 후 기록)

## 부록 C: Implementation Notes

(impl-notes 미전달)
