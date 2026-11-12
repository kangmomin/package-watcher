---
preset: node
language: ko
codexMode: none
# codexModels:                                              # 기본(미변경)이면 이 주석 2줄 그대로, 변경했으면 실제 codexModels 블록으로 교체
#   review: { provider: zai, model: glm-5.3, effort: high }

buildCommand: "npm run build"
testCommand:  "npm test"
lintCommand:  "npm run lint"
typeCheckCommand: "npm run typecheck"
makeTestCommand: ""

runServerCommand: "npm run dev"
serverUrl: "http://localhost:3000"
e2eEnabled: true
apiDocsPath: ""

sourceDirs: ["server"]
testDirs:   ["server"]

mainBranch: master
featureBranchPrefix: "feature/"
hotfixBranchPrefix:  "hotfix/"

commitPrefixes: [Add, Fix, Del, Refactor, Doc, Test, Chore, WIP]
commitCoAuthor: "Claude Fable 5.2 <noreply@anthropic.com>"

projectConventions: []
---

# Project Notes

- Spec: `docs/20261112-package-watcher-spec.md`
- 이 profile은 코드가 생기기 전에 만들었다. 명령(`npm run ...`)과 `sourceDirs`/`testDirs`는 Spec 기준의 예상 값이다. 구현 후 실제 `package.json` scripts와 다르면 `/be-harness:config`로 고친다.
- `web/`(Vite + React + shadcn)은 프론트엔드라서 `sourceDirs`에 넣지 않았다.
