---
preset: node
language: ko
codexMode: none
# codexModels:                                              # 기본(미변경)이면 이 주석 2줄 그대로, 변경했으면 실제 codexModels 블록으로 교체
#   review: { provider: zai, model: glm-5.3, effort: high }

framework: vite
uiLibrary: shadcn
stateManagement: tanstack-query
testRunner: vitest
e2eRunner: none
packageManager: npm
componentPattern: feature-based
typescript: true
storybook: false

buildCommand: "npm run build"
testCommand:  "npm test"
lintCommand:  "npm run lint"
typeCheckCommand: "npm run typecheck"
e2eCommand: ""
# e2eResetCommand: ""          # 선택 — 매 E2E 직전 멱등 기동 보장+데이터 초기화 (PROFILE.md)
# e2eIsolatedWorktree: false   # 선택 — 구현 중간 E2E를 worktree에서 병행 (PROFILE.md)

runServerCommand: "npm run dev"
serverUrl: "http://localhost:3000"

sourceDirs: ["web/src/"]
testDirs:   ["web/src/"]

mainBranch: master
featureBranchPrefix: feature/
hotfixBranchPrefix:  hotfix/

commitPrefixes: [Add, Fix, Del, Refactor, Doc, Test, Chore, WIP]
commitCoAuthor: "Claude Fable 5.2 <noreply@anthropic.com>"

projectConventions: ["default-conventions"]
---

# Project Notes

- Spec: `docs/20261112-package-watcher-spec.md`
- 이 profile은 코드가 생기기 전에 만들었다. 명령(`npm run ...`)과 `sourceDirs`/`testDirs`(`web/src/`)는 Spec 기준의 예상 값이다. 구현 후 실제 구조와 다르면 `/fe-harness:config`로 고친다.
- `e2eRunner: none` — Spec이 Playwright E2E를 범위에서 제외했다.
- Git 관련 값(`mainBranch`, 브랜치 prefix, `commitCoAuthor`)은 `.claude/be-harness.local.md`와 같게 맞췄다.
