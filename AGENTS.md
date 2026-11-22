# AGENTS.md

`web-video-subtitle-extension` 저장소의 개발·검증·보안 기준 문서입니다.

---

## 1. 프로젝트 개요 및 계층 구조

- **프로젝트**: Web Video Subtitle Extension (Chrome Manifest V3 확장프로그램)
- **목적**: 영상 사이트가 원하는 언어의 자막을 지원하지 않을 때, 외부 자막 검색·웹 폴백·점진적 AI 번역을 통해 원하는 언어의 자막(및 선택적 원문 동시 자막)을 영상 위에 오버레이 렌더링합니다. (현재 Miruro / Re:ANIME 한국어 자막 중심 지원, 범용 웹 영상·다국어 확장 진행 중)
- **디렉토리 계층**:
  - `src/sites/`: 지원 사이트별 작품·회차·내장 자막 감지 어댑터 (`miruro`, `reanime`)
  - `src/anime/`: 작품 메타데이터 정규화·AniList 해석·회차 파싱
  - `src/providers/`: 자막 제공자 (`anissia`, `web`, `jimaku`, `kitsunekko`, 일본어 통합 검색)
  - `src/subtitle/`: 자막 파이프라인, 파서(SRT/ASS/SMI/VTT/HLS), 렌더러, 압축/링크 리졸버(`links/*`), 캐시
  - `src/translation/`: 점진적 번역 큐, 번역 캐시, 번역 엔진(`gemini`, `openaiCompatible`, `lmstudio`)
  - `src/background/`: MV3 Service Worker, 메시지 라우터, 일본어 코디네이터, 프레임·네트워크·업데이트 관리
  - `src/content/`: ISOLATED world 라이프사이클/단축키 스크립트 및 MAIN world 응답 관찰 브릿지
  - `src/storage/`: 설정 스키마, IndexedDB, 회차별 싱크 저장소
  - `src/ui/`: 팝업(`popup/`) 및 설정 페이지(`settings/`)

---

## 2. 표준 개발 절차 (GitHub Flow & Quality Gate)

모든 코드·설정·테스트·워크플로우 변경(`src/`, `tests/`, `scripts/`, `manifest.json`, `.github/` 등)은 아래 절차를 따릅니다.

1. **Issue 등록**: 작업 착수 전 GitHub Issue(`#N`)를 생성해 단일 작업 기준을 확보합니다.
2. **작업 브랜치 운용**: `main`에 직접 커밋·병합하지 않고 이슈 번호 기반 브랜치(`feat/issue-N-...`, `fix/issue-N-...`, `chore/issue-N-...`)에서 작업합니다.
3. **원자적 구현 및 테스트**: 작업 범위에 맞는 최소 변경으로 구현하고, 기능 추가·버그 수정 시 `tests/`에 단위 테스트를 추가·보강합니다.
4. **필수 Quality Gate 통과**: PR 생성 전 아래 명령이 모두 통과해야 합니다(Windows PowerShell에서는 `npm.cmd` 사용).
   - `npm run typecheck` (`tsc --noEmit` 에러 0건)
   - `npm test` (`vitest run` 전체 단위 테스트 통과)
   - `npm run build:personal` 및 `npm run build:public` (두 배포 타겟 모두 빌드 성공)
   - **실제 브라우저 E2E 게이트 (UI · CSS · Content Script · 렌더러 · 사이트 어댑터 변경 시 필수)**: 코드 읽기만으로 통과 금지. 빌드된 `dist/`로 Playwright 실제 Chromium 회귀 테스트(`npm run test:browser`, `test:browser:mobile`, `test:browser:auto`, `test:browser:dual`, `test:browser:settings`, `test:browser:progressive`, `node scripts/browser-frames.mjs`)를 모두 통과해야 합니다.
   - **실사이트 스모크 & 베타 선검증 (배포 전 필수)**: 정식 Release 태그(`vX.Y.Z`)는 바로 발행하지 않고, `node scripts/research-live.mjs`로 Miruro / Re:ANIME 실접속 어댑터 응답(`ok: true`)을 확인한 뒤 **로컬 `dist/` 또는 베타 빌드로 사용자 실사용 테스트를 거친 후에만** 정식 릴리스를 발행합니다.
5. **PR 및 CI 검증**: 원격 브랜치 푸시 후 `main` 대상 PR을 생성하고 본문에 `Closes #N`을 명시합니다. `.github/workflows/ci.yml` 통과 확인 후 저장소 관리자의 승인을 거쳐 병합합니다.
6. **작성 규칙**:
   - GitHub Issue, PR, Commit 메시지는 영문(English)으로 작성합니다.
   - 정식 Release 제목은 버전 태그만 표기합니다(예: `v0.5.6`).
   - Git Author / Committer는 `puruuun <188972188+puruuun@users.noreply.github.com>`으로 통일합니다.

---

## 3. 사전 확인 기준 (Approval Gates)

아래 변경은 독단적으로 진행하지 않고 사전에 저장소 관리자의 확인을 받습니다.

1. **보안·권한 변경**: `manifest.json`의 권한(`permissions`, `host_permissions`, `optional_host_permissions`), CSP, `TRUSTED_CONTEXTS`, 외부 통신 도메인 추가, API Key·토큰 저장/전달 방식 변경
2. **주요 설계·UX 변경**: 사용자에게 보이는 UI/UX 흐름 변경, 설정 스키마(`schemaVersion`) 변경, 아키텍처 트레이드오프 결정
3. **병합 및 배포**: `main` 브랜치 PR Merge 및 정식 Release 태그 발행 직전

---

## 4. 절대 안전·보안 불변 규칙 (Safety Invariants)

1. **스토리지 및 자격증명 격리**:
   - `chrome.storage.local` 및 `chrome.storage.session`의 `accessLevel: 'TRUSTED_CONTEXTS'` 설정을 약화시키지 않습니다.
   - API Key(Gemini, Local LLM, Jimaku, Google CSE) 및 GitHub 업데이트 토큰은 Service Worker와 신뢰된 확장 UI(`popup.html`, `settings.html`)에서만 다루며, Content Script·`pageBridge.ts`(MAIN world)·웹페이지 DOM/콘솔에 절대 노출하지 않습니다.
2. **빌드 프로필 분리 유지**:
   - `personal` 빌드(`<all_urls>`)와 `public` 빌드(선언 호스트 + 선택적 호스트)의 분리를 유지합니다.
   - AUTO 모드 실행 중 `chrome.permissions.request` 권한 팝업을 자동으로 띄우지 않습니다.
3. **미디어 무결성 정책**:
   - 영상·오디오 스트림이나 미디어 세그먼트(`.ts`, `.m4s`, `.mp4`, `.aac`, `.mp3`, `.webm`)를 다운로드하거나 전사하지 않습니다. 텍스트 기반 자막 파일만 처리합니다.
4. **저장소 청결 및 비밀정보 보호**:
   - `.env`, 실제 API Key, 개인 토큰, 저작권이 있는 실제 자막 원문 파일(`.srt`, `.ass`, `.smi`, `.vtt`), 빌드 산출물(`.zip`, `dist/`) 및 생성된 QA 이미지·임시 JSON을 Git에 커밋하지 않습니다.
