# v0.5.0 권한·AUTO 자막 UX 개편 결과

검증일: 2026-10-02 (KST). 개인용 및 공개용 빌드를 모두 검증했습니다. 사용자 Chrome은 조작하지 않았으며, 요청에 따라 직접 설치할 수 있는 ZIP을 제공합니다.

## 반복 권한 요청의 실제 원인

v0.4.2는 `storage/scripting/activeTab/webNavigation`과 서비스 API·지원 사이트의 required host를 선언했습니다. 외부 플레이어, Blogspot·티스토리와 Google Drive 다운로드 host는 `optional_host_permissions: [https://*/*, http://*/*]`에 의존했습니다. `optional_permissions` 선언은 없었습니다.

팝업은 iframe/자막 URL이 발견되면 권한 승인 여부와 무관하게 접근 허용 버튼을 노출했습니다. 플레이어 접근 버튼과 Anissia 후보 버튼에 각각 `chrome.permissions.request`가 있었고, 배포 글 → Drive 파일처럼 새 host가 나타날 때 추가 승인이 필요했습니다. 다른 제작자·플레이어 host도 추가 대상이었습니다. 이미 승인한 같은 host를 회차마다 자동 해제하는 코드는 없었습니다.

`all_frames: true`여도 matches가 Miruro/Re:ANIME에만 한정되어 외부 player에는 자동 적용되지 않았습니다. `activeTab`은 클릭에 따른 임시 접근이며 외부 iframe 전체의 영구 권한을 제공하지 않습니다. 플레이어가 주입되지 않으면 video가 감지되지 않아 기존 FRAME_READY 기반 AUTO도 막혔습니다. 팝업의 수동 주입/실행 버튼이 이 경로를 보완하고 있었습니다.

## 실제 player 조사

| 사이트 | 실제 확인된 player | 확인 내용 |
| --- | --- | --- |
| Miruro | `https://strm.cx/?embed=1` | 제공한 2기 EP12 및 다른 작품 EP1에서 cross-origin iframe 확인. top 문서 video 0개. |
| Re:ANIME | `https://flixcloud.cc/e/{id}?v=1...` | 나루토 EP1/EP2의 cross-origin player iframe 확인. top 문서 video 0개. |

영상/textTracks 읽기와 렌더링은 해당 iframe 안에서 실행해야 합니다. 두 실제 host를 required permission과 content_scripts.matches에 추가했습니다. 댓글용 `theanimecommunity.com`은 player에 포함하지 않았습니다. `fetch9.flixcloud.cc`의 thumbnail VTT 요청도 관찰했지만 자막이라고 확인되지 않아 공개용 자막 host로 추정 추가하지 않았습니다.

실제 조사 당시 Miruro player는 `404 / TRY SWITCHING PROVIDER`를 표시했습니다. Re:ANIME은 미디어 다운로드를 차단한 조사에서 재생 오류가 나타났습니다. 실제 host는 확인했지만 원격 스트림의 정상 재생은 확인하지 못했습니다. 근거: `player-host-research.json`, `player-runtime-research.json`.

## 변경된 설치 권한과 빌드 구조

두 빌드의 일반 permissions는 `storage`, `scripting`, `webNavigation`입니다. `activeTab`을 제거했습니다.

- **개인용(기본 설치 ZIP)**: required `host_permissions: ["<all_urls>"]`. optional host 없음. 동적 제작자/CDN/player/번역 endpoint도 재생 중 승인 창을 요청하지 않습니다.
- **공개용 ZIP**: 아래 known host를 required로 선언하고 unknown HTTP/HTTPS만 optional 후보로 남깁니다. unknown host는 초기 설정에서 명시적으로 승인할 수 있습니다. AUTO 실행 중에는 요청하지 않습니다.

공개용 required host 전체:

```text
https://*.miruro.to/*
https://miruro.to/*
https://www.miruro.to/*
https://reanime.to/*
https://strm.cx/*
https://flixcloud.cc/*
https://api.anissia.net/*
https://graphql.anilist.co/*
https://jimaku.cc/*
https://subtitles.ajatt.top/*
https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/*
https://generativelanguage.googleapis.com/*
http://127.0.0.1/*
http://localhost/*
https://*.blogspot.com/*
https://*.tistory.com/*
https://blog.kakaocdn.net/*
https://drive.google.com/*
https://drive.usercontent.google.com/*
```

`manifest.json`은 공개용 기준이며 `scripts/manifest-config.mjs`가 빌드 시 변환합니다. `npm run build` / `build:personal`은 개인용, `build:public`은 공개용입니다. 두 AUTO 검사 모두 실제 빌드 manifest를 변경하지 않았습니다.

Content Script와 MAIN bridge는 지원 사이트와 확인된 player에 `document_start`, `all_frames: true`, `match_about_blank`, `match_origin_as_fallback`으로 로딩됩니다. 개인용의 동적 iframe은 회차 준비 이벤트 및 iframe commit에서 주입합니다. 이미 주입된 script는 guard로 중복 설치를 막습니다. 과거 동적 host 등록 코드를 제거해 댓글/광고 host가 영구 content script 목록에 누적되지 않습니다.

## 제거한 request 호출과 권한 오류 UI

팝업의 두 `chrome.permissions.request` 호출 및 접근 허용 버튼을 제거했습니다. AUTO 검색/다운로드/번역/iframe 처리에는 request 호출이 없습니다. 남은 호출은 `src/ui/api.ts`의 초기 설정 helper 하나이며 공개용 unknown 서버/외부 endpoint 승인에 사용합니다.

helper는 contains를 먼저 확인합니다. required 권한이 차단됐으면 Chrome 확장 세부정보를 안내하고 request를 호출하지 않습니다. 팝업도 required host와 실제 player 접근을 확인합니다. 모든 AUTO 소스가 권한 차단으로 실패하면 HOST_ACCESS 상태로 중단하며 승인/재시도 루프에 들어가지 않습니다. 실제 Chrome 설정에서 사이트 접근을 제거하는 GUI 검사는 수행하지 않았습니다. 차단 branch는 unit test 및 required host를 제거한 격리 테스트 manifest로 검증했습니다.

## EpisodeLifecycleManager·중복 방지·취소

`SiteAdapter → AnimeContext → EpisodeLifecycleManager → SubtitleCore/SubtitlePipeline`으로 연결했습니다. 최초 진입, 다른 작품/회차, 다음 회차로 생기는 URL/DOM 변경, pushState/replaceState/popstate, player 교체를 감지합니다. MAIN history hook과 MutationObserver 및 400ms interval을 사용합니다. notification은 100ms로 합치고 context가 최소 2번 같으며 400ms 안정적일 때 준비 이벤트를 보냅니다. metadata가 없는 hydration 구간은 다시 확인합니다.

key는 `site:animeId:season:episode:type`이며 예시는 `miruro:154587:1:7:tv`입니다. 사이트 작품 ID를 우선해 늦은 AniList ID/별칭이 같은 회차를 재시작하지 않습니다. 같은 key의 진행/완료 job은 재실행하지 않으며 per-tab 직렬 lifecycle로 race를 막습니다. player document/revision 변경은 같은 회차의 저장된 renderer 상태만 복원합니다.

SPA route 변경 즉시 EPISODE_NAVIGATING으로 이전 AbortController·queue를 취소하고 전체 페이지 이동도 onBeforeNavigate에서 취소합니다. epoch/document 검사로 늦은 이전 회차 결과를 거부합니다. Anissia/Jimaku/Kitsunekko/download/Local LLM/Gemini HTTP 요청에 signal이 전파됩니다. EP1→EP2→EP3 검사에서 EP1 모델 요청의 연결 종료가 관찰됐고 EP2는 debounce로 생략됐으며 EP3 대사만 남았습니다. 모델 서버 내부 연산의 종료까지 보장하는 서버 API는 사용하지 않습니다.

worker가 재시작되면 session의 AUTO 상태/재시도 시각을 복원합니다. 완료/정지 job은 heartbeat로 다시 번역하지 않습니다. 수동으로 수정한 작품/시즌도 초기 DOM 안정화 이벤트가 덮어쓰지 않습니다.

## AUTO 기본값·Progressive·캐시

신규 설치는 `mode: auto`, `autoApply: true`, Anissia/일본어 번역/Embedded English 모두 ON입니다. 기존 명시적 수동 설정과 서버/키는 유지합니다. AUTO는 **Anissia 한국어 → Jimaku 일본어 → Kitsunekko 일본어 → Embedded English** 순서입니다. JA/EN은 선택한 Local LLM 또는 Gemini로 번역하며 한국어가 준비되면 모델을 호출하지 않습니다.

처음 20 Cue가 준비되면 즉시 renderer에 전달하고 이후 기본 45 Cue씩 background 번역합니다. Seek 우선순위, fullscreen, 싱크, 원본 Cue ID/time 보존, 실패 Chunk 재시도도 회귀 검사에서 통과했습니다.

24시간 EpisodeCache를 AniList/provider 검색보다 먼저 적용합니다. cache key는 사이트 작품/시즌/회차, 모드, 소스 설정, 엔진/model/endpoint, prompt version과 Chunk 옵션을 포함합니다. 완료 자막은 검색/download/LLM 없이 적용합니다. 부분 cache는 원본 Cue도 보존해 provider 재검색 없이 누락 번역만 이어갑니다. 기존 원본 및 TranslationQueue Chunk cache를 유지했습니다. 다시 검색은 EpisodeCache를 건너뛰지만 원본/Chunk cache까지 강제로 비우지는 않습니다.

최종 격리 검사에서 개인용 KO 재방문 782ms, 번역 재방문 959ms였으며 provider/download/LLM 추가 호출 0회였습니다. 공개용은 924ms/960ms였습니다. 회차 DOM 안정 확인을 포함한 시간입니다.

## 재시도 간격 실측

600ms 비용의 실제 로컬 HTTP 요청으로 서비스가 1초/4.5초/9초 뒤 복구되는 9개 시나리오를 비교했습니다.

| 최초 재시도 간격 | 평균 복구 시간 | 총 요청 수 |
| --- | ---: | ---: |
| 2초 | 9,170ms | 9 |
| 3초 | 8,638ms | 8 |
| 5초 | 9,763ms | 7 |

이 시험에서 평균 복구가 가장 빠른 3초를 선택했습니다. 이후 6초/12초/20초/20초로 늘리고 최대 6회 실행합니다. 새 재시도 시작은 회차 진입 후 2분 이내로 제한합니다. 정상 진행 중인 background 번역을 2분에 강제로 끊지는 않습니다. player는 1초 간격 및 DOM/FRAME_READY 이벤트로 확인하며, 삽입 후 개인용170ms/공개용173ms에 적용됐습니다.

HTTP503→복구는 개인용3,680ms/공개용4,023ms에 완료됐습니다. 실패 Chunk 자동 재시도는 완료20 Cue와 원본을 복원해 재검색/download 없이 나머지를 번역했습니다. 설정 오류/권한 차단은 반복하지 않습니다. 상단은 이유/시도 횟수/countdown을 표시하며 수동 전환을 즉시 제공합니다. 원격 서버마다 최적 간격은 달라질 수 있습니다.

## UI 변경

- 고정 상단 작업 상태창: 모드, 작품/EP, 단계/메시지, Source/engine/cache, 경고, 재시도 countdown/횟수, 재생/경과 시간, 번역 완료 시각, Buffer/Chunk 진행.
- 아래 조작 영역만 스크롤됩니다. 상태창 y 좌표가 스크롤 전후 같음을 검사했습니다.
- 작업 중 수동 전환 가능: 검색/번역/예약 재시도를 취소합니다. AUTO로 복귀하면 현재 회차를 자동 실행합니다.
- 큰 한국어 자막 적용 버튼과 그 아래 피드백창 제거. AUTO는 다시 검색/번역 재시작, Manual만 세 경로의 명시적 실행을 제공합니다.
- 팝업 ANIME / SUBTITLE 및 한국어로 이어지는 이야기 제목 제거. 설정 제목은 설정만 남겼습니다.
- `auto-popup.png`, `auto-settings.png`를 직접 시각 확인했습니다.

## 테스트 결과

| 요청 시나리오 | 결과/범위 |
| --- | --- |
| 새 프로필/설치/최초 권한 | 격리 Chromium. 두 manifest의 required grant, AUTO 기본값, 초기 설정 탭 확인. 실제 사용자 Chrome 설치 GUI 승인창 미검증. |
| Miruro EP1 | 실행 버튼 없이 한국어 적용. |
| Miruro EP2 | 자동 새 job, 권한 request 0. |
| 다른 Miruro 작품 | 새 작품 ID 자동 감지, request 0. |
| Re:ANIME 진입 | flixcloud iframe 자동 주입/적용. |
| Re:ANIME EP2 | SPA/iframe 변경 후 자동 적용, request 0. |
| player 변경 | flixcloud→strm. 같은 job/검색 호출 유지, renderer 복원. 동적 iframe/전체화면도 통과. |
| fallback | Anissia→Jimaku→Kitsunekko→English. Local LLM/Gemini 회귀 통과. |
| 재방문 | EpisodeCache 우선, provider/download/LLM 0. |
| 빠른 EP1→EP2→EP3 | 이전 LLM abort, EP2 생략, EP3만 적용. |
| 미완료/재시도/수동 | 일시 오류/partial cache/player 대기/수동 취소/AUTO 재개 통과. |

개인/공개 AUTO 각각 **24/24**, runtime permission requests 각각 **0**입니다. manifest를 바꾸지 않았으며 모의 사이트/자막/모델로 실제 MV3 worker, Content Script, history, storage, renderer를 실행했습니다. 실제 원격 영상 재생/모델 번역 품질을 증명하는 시험은 아닙니다.

추가 브라우저 검사: 기존 Pipeline17, Progressive9, iframe/renderer/fullscreen5, 실제 Anissia3, 실제 Blogspot/Drive4. 총 **86개 통과**입니다.

실제 서비스 시험에서 사용자 제공2기12화(누적24화)는 AUTO로425 Cue를 받고 첫 한국어 대사를 렌더링했습니다. Anissia2798의 통합 Drive ZIP에서 EP1 468 Cue, Anissia3041의 최신13화 글→Blogger feed→1화 Drive ASS에서 EP1 1,667 Cue를 실제 다운로드/파싱/렌더링했습니다. 공개용 known-host manifest에 추가 승인하지 않았습니다. v0.4.2 제작자4종 전체46회차 시험은 과거 기록이며 이번86개에 합산하지 않았습니다.

`npm run check`: typecheck, **180 unit tests**, 개인용 build 통과. 공개용 build도 통과. 증거: `auto-lifecycle-browser-report.json`, `auto-lifecycle-public-browser-report.json`, `auto-retry-timing-report.json`, `browser-report.json`, `progressive-report.json`, `frame-report.json`, `anissia-browser-live-report.json`, `anissia-distribution-browser-report.json`.

## 제한과 설치

현재 확인한 player host가 향후 바뀌면 공개용은 manifest 업데이트 또는 초기 host 승인 필요. 개인용은 동적 host에도 required 접근을 사용합니다. upstream player404, 서비스 장애, 로그인/Drive 다운로드 제한, 모델 품질은 확장이 해결하지 못합니다. renderer에는 사용 가능한 video가 필요합니다. Blogspot 검색 최대100개/파일8MB 한도와 ASS 고급 스타일 제한을 유지합니다.

사용자 Chrome은 직접 설치하기로 한 선택을 유지했습니다. Chrome120 이상에서 기본 개인용 ZIP을 풀고 extension 폴더를 로드하세요. 구버전과 중복 로드하지 마세요. 기존 설치 폴더 교체+확장 새로고침으로도 업데이트할 수 있습니다. 기존 수동 설정이면 자동 전환을 선택하세요. 저장소는 private 상태를 유지하며 다른 컴퓨터에서는 저장소 접근이 있는 GitHub 계정으로 Release를 받을 수 있습니다. ZIP은 Chrome에 로드하는 설치 패키지입니다.
