# AGENTS.md — 프로젝트 헌법 및 에이전트 오케스트레이션 규칙

이 문서는 `anime-korean-subtitle-extension` 저장소에서 작업하는 모든 AI 에이전트(총괄 감독 및 서브에이전트)가 반드시 준수해야 하는 최상위 규칙입니다.

---

## 1. 프로젝트 개요 및 핵심 아키텍처

- **프로젝트명**: Anime Korean Subtitle (Chrome Manifest V3 확장프로그램)
- **목적**: Miruro / Re:ANIME 영상 페이지에서 현재 작품·회차를 감지하고 외부 한국어 자막(Anissia) 또는 일본어(Jimaku → Kitsunekko)·내장 영어 자막을 확보하여 한국어(및 선택적 일본어 원문 동시 자막)를 렌더링합니다.
- **핵심 계층**:
  - `src/background/`: MV3 Service Worker (`serviceWorker.ts`), 작업/상태 라우터 (`messageRouter.ts`, `routerTypes.ts`, `japaneseCoordinator.ts`), 프레임 관리 (`frameManager.ts`), 네트워크 (`network.ts`), 업데이트 확인 (`updates.ts`)
  - `src/content/`: ISOLATED world 스크립트 (`contentScript.ts`, `EpisodeLifecycleManager.ts`, `shortcuts.ts`) 및 MAIN world 공개 응답 관찰 브릿지 (`pageBridge.ts`)
  - `src/subtitle/`: 자막 파이프라인 (`SubtitlePipeline.ts`, `SubtitleCore.ts`), 파서 (`SubtitleParser.ts`, `HLSSubtitles.ts`), 렌더러 (`SubtitleRenderer.ts`), 배포 링크 해석기 (`src/subtitle/links/*`), 캐시 (`EpisodeCache.ts`, `SubtitleCache.ts`)
  - `src/providers/`: 자막 제공자 (`AnissiaProvider.ts`, `JimakuProvider.ts`, `KitsunekkoProvider.ts`, `JapaneseSubtitleSearchManager.ts`)
  - `src/translation/`: 점진적 번역 큐 (`TranslationQueue.ts`), 캐시 (`TranslationCache.ts`), 번역 엔진 (`GeminiProvider.ts`, `OpenAICompatibleProvider.ts`, `LMStudioProvider.ts`)
  - `src/ui/`: 팝업 (`popup/main.tsx`) 및 설정 (`settings/main.tsx`, `ExtensionUpdates.tsx`)

---

## 2. 표준 개발 절차: GitHub Flow (코드 PR / 문서 Direct Push) + Quality Gate

특별한 지시가 없는 한 모든 개발 작업은 변경 대상에 따라 아래 절차를 따릅니다.

- **일반 문서 단독 수정 (`AGENTS.md`, `TASKS.md`, `README.md` 등 `*.md` 문서 파일)**:
  - 별도의 Issue나 PR 생성 없이 `main` 브랜치에 직접 커밋 및 푸시(`git push origin main`)합니다.
- **코드·설정·테스트·워크플로우 관련 모든 수정 (`src/`, `tests/`, `scripts/`, `manifest.json`, `.github/` 등)**:
  - 아래 1~7단계의 **GitHub Issue → 원격 Branch → Pull Request(PR) → GitHub Actions CI → Merge** 절차를 반드시 준수합니다.

1. **GitHub Issue 등록 및 작업 지시서 확정 (`Issues` 탭 + `TASKS.md`)**
   - 새로운 기능, 버그 수정, 리팩토링 등 **코드 관련 작업**은 착수 전 **GitHub 저장소의 실제 Issue(`https://github.com/puruuun/anime-korean-subtitle-extension/issues`)로 등록**하여 고유 이슈 번호(`#N`)를 부여받습니다.
   - 작업 착수 전 총괄 감독(Argon)이 해당 이슈 번호를 기반으로 구체적인 **작업 지시서(Work Order)**를 확정합니다.
2. **원격 작업 브랜치 운용 (`Branches` 탭 — 코드 수정 시 로컬 `main` 직접 병합/푸시 금지)**
   - `main` 브랜치는 항상 배포 및 테스트가 통과하는 안정 상태로 유지하며, **코드 관련 수정은 로컬에서 `main`으로 직접 `git merge`하거나 `git push origin main`을 절대 수행하지 않습니다.**
   - 모든 코드 작업은 이슈 번호와 연동된 브랜치(`feat/issue-N-...`, `fix/issue-N-...`, `refactor/issue-N-...`)에서 수행하고, 로컬 Quality Gate 통과 후 **원격 저장소에 브랜치를 그대로 푸시(`git push -u origin <branch>`)**합니다.
3. **원자적(Atomic) 구현 및 테스트 추가**
   - 지시서에 명시된 허용 파일 범위 내에서만 코드를 수정합니다.
   - 버그 수정이나 기능 추가 시 반드시 `tests/` 하위에 해당 동작을 검증하는 단위 테스트를 함께 작성하거나 보강합니다.
4. **필수 품질 관문 (Quality Gate)**
   - Windows PowerShell 환경에서는 실행 정책(ExecutionPolicy)으로 인해 `npm.ps1` 대신 `npm.cmd`를 사용해야 하며, Node.js 런타임 경로를 세션 `PATH`에 포함해 실행합니다:
     ```powershell
     $env:PATH = "C:\Users\rl\Documents\Codex\2026-10-28\https-github-com-ventianima-lab-codex\work\node-runtime\node-v24.22.1-win-x64;" + $env:PATH
     Set-Location "C:\Users\rl\.gemini\antigravity\scratch\anime-korean-subtitle-extension"
     npm.cmd run check
     ```
   - 모든 코드 변경은 PR 생성 전 아래 명령을 통과해야 합니다:
     - `npm.cmd run typecheck` (`tsc --noEmit` 에러 0건)
     - `npm.cmd test` (`vitest run` 전체 단위 테스트 통과)
     - `npm.cmd run build:personal` 및 `npm.cmd run build:public` (두 배포 타겟 모두 빌드 성공)
5. **Git 작성자(Contributors) 단일화 및 영문 작성 규칙**
   - 모든 Git 커밋 및 태그의 Author / Committer는 반드시 프로젝트 소유자인 `puruuun <188972188+puruuun@users.noreply.github.com>`으로 설정해야 하며, AI 에이전트 이름(`Codex`, `Claude`, `Gemini` 등)이나 `Co-authored-by:` 트레일러를 절대 포함하지 않습니다.
   - GitHub에 등록하는 모든 **Issue, Pull Request(PR), Commit 메시지**는 반드시 **영문(English)**으로 작성하며, 정식 Release 제목은 앞에 별도 이름을 붙이지 않고 버전 태그만 표기합니다(예: `v0.5.4`).
6. **GitHub Pull Request(PR) 생성 및 GitHub Actions CI 검증 (`Pull requests` 탭)**
   - 원격 브랜치 푸시 후 GitHub API를 통해 `main` 브랜치 대상 **Pull Request(PR)**를 생성하고, 본문에 `Closes #N`을 명시하여 Issue와 자동 연결합니다.
   - PR에서 `.github/workflows/ci.yml`(자동 품질 관문)이 통과(✅)하는 것을 확인합니다.
7. **감독 최종 검수 (Final Review) 및 PR 병합 승인**
   - 서브에이전트가 작업을 완료하면 총괄 감독(Argon)이 `git diff`, 로컬 테스트, 생성된 GitHub PR 링크 및 GitHub Actions 결과를 사용자에게 보고하고, 사용자의 승인(또는 웹에서의 직접 Merge 클릭)을 통해 PR을 병합합니다.

---

## 3. 에이전트 오케스트레이션 규칙 (Director + Subagents)

### 3.1 역할 분담
- **총괄 감독 (Director — Gemini 4 Argon)**:
  - 프로젝트 기획, 요구사항 분석, GitHub Issue/PR 관리, 아키텍처 결정, **작업 지시서(Work Order) 작성**을 전담합니다.
  - 작업 특성에 맞춰 서브에이전트(`research`, `coder`, `verifier` 등)를 유동적으로 생성·호출합니다.
  - 서브에이전트가 제출한 결과물의 코드 품질, 보안 불변식 준수 여부, 테스트 커버리지를 **최종 검수**합니다.
- **실무 서브에이전트 (Workers — Flash 모델 기본 활용)**:
  - 감독이 전달한 작업 지시서의 범위와 제약사항을 엄격히 준수하여 탐색, 코드 작성, 테스트 실행을 수행합니다.
  - 지시서 범위를 벗어나는 파일 수정이나 임의의 설계 변경을 금지합니다. 작업 중 예상치 못한 이슈를 발견하면 임의로 우회하지 않고 감독에게 즉시 보고합니다.

### 3.2 작업 지시서(Work Order) 필수 포함 항목
감독이 서브에이전트에게 작업을 위임할 때는 반드시 다음 5가지를 명시합니다:
1. **[Issue # / Task ID 및 목표]**: 해결할 문제와 기대 결과
2. **[수정 허용 파일 목록]**: 수정/생성 가능한 정확한 파일 경로 (이외 파일 수정 금지)
3. **[상세 구현 명세]**: 수정할 함수/클래스, 입출력 조건, 엣지 케이스 처리 방법
4. **[안전 및 호환성 제약]**: 건드리면 안 되는 기존 동작 및 보안 규칙
5. **[완료 조건 (Definition of Done)]**: 추가할 테스트 케이스 및 통과해야 할 검증 명령

### 3.3 사용자 필수 보고 기준 (User Escalation Gates)
총괄 감독(Argon)은 다음 상황에서 독단적으로 진행하지 않고 **반드시 사용자에게 먼저 보고하고 결정을 받습니다**:
1. **보안 및 권한 변경**: `manifest.json`의 권한(`permissions`, `host_permissions`, `optional_host_permissions`), CSP, `TRUSTED_CONTEXTS`, 외부 통신 도메인 추가, API Key/토큰 저장 및 전달 방식에 변경이 필요한 경우
2. **중요 설계 및 UX 변경**: 사용자에게 보이는 UI/UX 흐름 변경, 설정 스키마(`schemaVersion`) 변경, 여러 설계 대안 중 트레이드오프 선택이 필요한 경우
3. **최종 검수 및 PR 병합/배포 전**: 각 작업의 PR 생성 및 GitHub Actions 검증이 완료되어 `main` 브랜치로의 PR Merge 또는 Release 생성을 진행하기 직전

---

## 4. 절대 안전 및 보안 불변 규칙 (Safety Invariants)

1. **스토리지 및 자격증명 격리**:
   - `chrome.storage.local` 및 `chrome.storage.session`의 `accessLevel: 'TRUSTED_CONTEXTS'` 설정을 절대 약화시키지 않습니다.
   - API Key(Gemini, Local LLM, Jimaku) 및 GitHub 업데이트 토큰은 오직 Service Worker와 신뢰된 확장 UI(`popup.html`, `settings.html`)에서만 다루며, Content Script나 `pageBridge.ts`(MAIN world), 웹페이지 DOM/콘솔에 절대 노출하지 않습니다.
2. **빌드 프로필 분리 유지**:
   - `personal` 빌드(`<all_urls>`)와 `public` 빌드(선언된 지원 호스트 + 선택적 호스트)의 분리를 유지합니다.
   - AUTO 모드 실행 중에는 `chrome.permissions.request` 권한 팝업을 자동으로 띄우지 않습니다.
3. **미디어 무결성 정책**:
   - 영상·오디오 스트림이나 미디어 세그먼트(`.ts`, `.m4s`, `.mp4`, `.aac`, `.mp3`, `.webm`)를 다운로드하거나 전사하지 않습니다. 오직 텍스트 기반 자막 파일만 처리합니다.
4. **저장소 청결 및 비밀정보 보호**:
   - `.env`, 실제 API Key, 개인 토큰, 저작권이 있는 실제 자막 원문 파일(`.srt`, `.ass`, `.smi`, `.vtt`)을 Git에 커밋하거나 배포 아카이브에 포함하지 않습니다.
   - 작업과 무관한 기존 주석이나 문서 내용을 임의로 삭제하지 않습니다.
