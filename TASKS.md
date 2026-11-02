# TASKS.md — 프로젝트 작업 현황판 (Backlog & Progress)

> **운용 규칙**: 모든 작업은 `AGENTS.md`의 **GitHub Flow + Quality Gate** 절차에 따라 진행됩니다.
> - 상태 표기: `[ ] Todo` | `[~] In Progress` | `[?] Review (검수 중)` | `[x] Done`

---

## Priority 1: 핵심 버그 및 정확도 수정 (Bug Fixes)

| Task ID | 상태 | 작업 제목 | 대상 파일 | 비고 |
| :--- | :---: | :--- | :--- | :--- |
| **TASK-001** | `[x] Done` | **내장 일본어(HLS) 자막 로드 시 영어 트랙만 필터링하는 버그 수정** | `src/subtitle/HLSSubtitles.ts`, `src/subtitle/EmbeddedSubtitleLoader.ts`, `tests/subtitle.test.ts` | `loadHLSSubtitles`가 `language`('en' \| 'ja')에 맞는 `#EXT-X-MEDIA` 트랙을 선택하도록 개선 |
| **TASK-002** | `[x] Done` | **번역 프롬프트 불필요 필드(`previousTranslations`) 정리 및 작품 컨텍스트 주입** | `src/translation/prompts.ts`, `src/translation/TranslationProvider.ts`, `src/translation/TranslationQueue.ts`, `src/translation/gemini/GeminiProvider.ts`, `src/translation/openaiCompatible/OpenAICompatibleProvider.ts`, `tests/translation.test.ts` | 옵션 A 확정: `previousTranslations` 제거 및 `animeTitle` 컨텍스트 전달 |
| **TASK-003** | `[x] Done` | **ASS/SSA 자막 파싱 시 드로잉 명령(`{\p1}...{\p0}`) 좌표 노출 방지** | `src/subtitle/SubtitleParser.ts`, `tests/subtitle.test.ts` | 벡터 드로잉 블록이 대사로 파싱되어 화면/번역에 포함되는 문제 해결 |
| **TASK-004** | `[x] Done` | **SMI(SAMI) 자막 종료 싱크 및 장시간 잔류 대사 처리 보강** | `src/subtitle/SubtitleParser.ts`, `tests/subtitle.test.ts` | 공백/주석 싱크 처리 및 비정상적으로 긴 마지막/중간 대사 표시 시간 안전장치 추가 |

---

## Priority 2: 성능 및 안정성 개선 (Performance & Reliability)

| Task ID | 상태 | 작업 제목 | 대상 파일 | 비고 |
| :--- | :---: | :--- | :--- | :--- |
| **TASK-005** | `[x] Done` | **HLS 자막 세그먼트 제한적 병렬 다운로드 도입** | `src/subtitle/HLSSubtitles.ts`, `tests/subtitle.test.ts` | 세그먼트 직렬 로드 병목 해소 (10초 데드라인 내 안정적 처리) |
| **TASK-006** | `[x] Done` | **IndexedDB 캐시 만료 항목 정리(Eviction/GC) 메커니즘 추가** | `src/storage/database.ts`, `src/subtitle/EpisodeCache.ts`, `src/subtitle/SubtitleCache.ts`, `tests/episodeCache.test.ts` | 만료된 캐시 및 오래된 항목 정리로 스토리지 무한 증가 방지 |
| **TASK-007** | `[x] Done` | **`SubtitleRenderer` 프레임 렌더링 및 Cue 탐색 최적화** | `src/subtitle/SubtitleRenderer.ts`, `tests/renderer.test.ts` | 불필요한 DOM 스타일 재할당 최소화 및 정렬된 Cue 탐색 최적화 |
| **TASK-008** | `[x] Done` | **팝업(Popup) 상태 폴링 경량화** | `src/ui/popup/main.tsx` | 1초 주기 폴링 시 불필요한 `ACCESS_STATUS` / `GET_PREFERENCES` 중복 호출 분리 |

---

## Priority 3: 기능 개선 및 구조 리팩토링 (Enhancements & Refactoring)

| Task ID | 상태 | 작업 제목 | 대상 파일 | 비고 |
| :--- | :---: | :--- | :--- | :--- |
| **TASK-009** | `[x] Done` | **플레이어 키보드 단축키 지원 (싱크 ±0.5s 조절 및 일본어 자막 토글)** | `src/content/shortcuts.ts`, `src/content/contentScript.ts`, `src/background/serviceWorker.ts`, `src/ui/popup/main.tsx`, `tests/shortcuts.test.ts` | 옵션 A 확정: `Alt+[`, `Alt+]`, `Alt+\`, `Alt+J` |
| **TASK-010** | `[x] Done` | **`messageRouter.ts` 책임 분리 리팩토링** | `src/background/messageRouter.ts`, `src/background/routerTypes.ts`, `src/background/japaneseCoordinator.ts` | 1,070줄 단일 파일을 타입/스냅샷 및 일본어 트랙 코디네이터로 모듈화 |
| **TASK-011** | `[x] Done` | **GitHub Actions CI/Release 워크플로우 구축 및 Git 작성자(Contributors) 규칙 명시** | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `AGENTS.md`, `TASKS.md` | CI 자동 검증 및 정식 배포 자동화, 단일 작성자(puruuun) 불변 규칙 확립 |
