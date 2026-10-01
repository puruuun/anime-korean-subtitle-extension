# v0.4.0 구현 및 검증

검증일: 2026-10-01 (Asia/Seoul). 기반 소스: `ed72faa47421d20a354291b2919b79352275783d`.

## 구현

`SubtitlePipeline`은 source 획득만 담당하고 `SubtitleCore`는 준비된 일본어/영어 Cue를 기존 `TranslationQueue`로 전달합니다. SiteAdapter는 작품·회차·내장 자막 감지만 수행합니다.

AUTO 순서는 Anissia → Jimaku → Kitsunekko → embedded English입니다. 각 Provider의 후보 목록, 실제 다운로드, 압축 해제, 파싱이 분리되어 있으며 파싱된 Cue가 있어야 성공합니다. 한국어가 성공하면 번역 Provider를 만들지 않습니다. 실패한 제작자/파일은 같은 Provider의 다음 후보를 시도하고 단계 전체 제한시간이 지나면 다음 소스로 진행합니다.

`JapaneseSubtitleSearchManager`는 Jimaku → Kitsunekko를 고정 순서로 처리합니다. AniList 일치에는 높은 점수를 주며 회차/시즌/특별편 충돌을 제외합니다. 동일 회차의 여러 릴리즈는 점수와 안정적인 순서로 선택합니다. 수동 Korean / Japanese / English는 다른 언어 경로로 넘어가지 않습니다. 수동 Korean에서 해석 불가 페이지는 기존 후보·권한 안내 UI를 유지합니다.

새 설정은 schemaVersion 2입니다. 설정 allowlist로 오래된 Provider 저장 데이터를 제거하고 로컬 번역 서버·모델·표시 설정을 보존합니다. 기존 ko 기본 모드는 AUTO로, ja/en은 동일한 신규 수동 경로로 변환합니다. 알 수 없는 모드는 AUTO로 초기화합니다. 원래 OpenAI 호환 로컬 서버 설정도 Local LLM으로 계속 사용합니다.

첫 video FRAME_READY에서 자동 작업을 시작합니다. 회차 이동 시 기존 AbortController를 중단하고 새 epoch로 시작합니다. 자막 끄기/취소는 현재 페이지에서 재시작을 막습니다. 다음 회차에서는 새 context의 감지로 다시 시작합니다. 기존 큐의 Seek 우선순위, 첫 Chunk 준비 후 재생, Chunk delta/캐시/렌더러 업데이트는 유지합니다.

필수 호스트는 지원 사이트, 공개 자막 소스, Gemini, localhost입니다. 새 소스 API Key는 worker에서만 사용합니다. build-time Jimaku key도 worker에만 포함됩니다. 다양한 배포 페이지와 플레이어를 지원하기 위한 선택적 HTTP/HTTPS 권한은 사용자가 승인한 도메인에만 적용합니다.

## 검증 결과

- `npm run typecheck` / `npm run build`: 성공.
- `npm test`: 116개 테스트 성공.
- `npm run test:browser`: 실제 MV3 Service Worker / 팝업 / content script를 사용하는 17개 검사 성공.
- `npm run test:browser:progressive`: 기존 점진 번역 회귀 검사 9개 성공.
- `node scripts/browser-frames.mjs`: Re:ANIME iframe / fullscreen / stale epoch / credential isolation 검사 5개 성공.
- Jimaku build key 분리: 테스트 값을 넣고 worker에만 포함되는지 검사한 뒤 키 없이 다시 빌드했습니다. `qa/build-security-report.json`.
- 프로덕션 의존성 `npm audit --omit=dev`: 알려진 취약점 0개.

브라우저 자동 검사는 Chromium의 격리된 임시 프로필에서 수행하며 자막 서비스와 LLM 응답은 모의 응답입니다. 테스트용 blog.example / cdn.example / player.example 권한을 임시 manifest에만 사전 부여했습니다. 배포 manifest에는 테스트 도메인이 없습니다.

단위 검사는 Anissia 우선·번역 미호출, 페이지 resolve 실패 후 Japanese fallback, 다음 candidate, Jimaku 키 없음 및 401/403/429/500, 미러 회차 불일치, 내장 영어 최후 fallback, 수동 경로 분리, 단계 ON/OFF, 검색/다운로드 취소, source 전체 timeout, migration, source/hash/엔진/model/언어 cache 분리, 번역 응답 ID 검증을 포함합니다.

점진 번역 브라우저 검사는 첫 20 Cue, 이후 미완료 요청 중 첫 Chunk 표시, 18분 Seek 시 요청 취소·새 구간 우선, 원래 ID/시간 보존, 모든 Chunk 캐시 재사용, 즉시 재생, 다음 회차 중단, 실패 Chunk만 재시도를 검사합니다.

## 실제 외부 서비스

- Anissia: 실제 `/anime/schedule/0` 및 `/anime/caption/animeNo/{animeNo}`의 `code/data`, `episode/updDt/website/name`을 확인했습니다. 실제 개인 배포 페이지의 모든 링크를 검증한 것은 아닙니다.
- Jimaku: [공식 OpenAPI](https://jimaku.cc/api/openapi.json)에서 raw Authorization API key, `/api/entries/search?anilist_id=...`, `/api/entries/{id}/files`, Entry/FileEntry 필드를 확인했습니다. 실제 키 없는 요청은 401이었습니다. 실제 인증 검색·파일 다운로드는 키가 없어 미검증입니다.
- Kitsunekko: [미러 저장소](https://github.com/Ajatt-Tools/kitsunekko-mirror)와 [카탈로그](https://subtitles.ajatt.top/)의 작품 HTML 표, 상세 페이지, 공식 raw.githubusercontent.com 링크를 확인했습니다. Sousou no Frieren 7화의 실제 SRT를 다운로드하여 timecode를 확인했습니다. 구현한 `JapaneseSubtitleSearchManager`와 `KitsunekkoProvider` 자체로도 실제 검색·다운로드·파싱을 실행해 323 Cue를 확보했습니다 (약 1.8초). `qa/live-provider-report.json`.
- Gemini: [공식 API discovery schema](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta)의 generateContent / systemInstruction / responseJsonSchema 필드를 검증했습니다. JA와 EN, ID 오류·불완전 응답·모델 목록을 모의 응답으로 검사했습니다. 실제 API Key가 없어 유료/인증 모델 호출은 수행하지 않았습니다.
- Local LLM: 로컬 HTTP 모의 서버로 요청 내용, 첫 Chunk/후속 Chunk, 캐시, Seek, 회차 취소를 검증했습니다. 실제 LM Studio 모델은 로드되어 있지 않아 번역 품질·속도는 미검증입니다.

서비스 확인 증거: `qa/services-report.json`.

## 실제 Miruro / Re:ANIME

`node scripts/research-live.mjs`는 빌드된 확장프로그램을 로드하고 실제 웹페이지의 content script에 CONTEXT 메시지를 보내 SiteAdapter 결과를 받았습니다. 영상·음성 요청은 차단했습니다.

- Miruro: 실제 watch 페이지에서 `Reincarnated as a Sword Season 2`, 회차 1, 시즌 2를 감지했습니다.
- Re:ANIME: 실제 `Naruto` 회차 1, year 2002, AniList/MAL ID 20, TMDB/IMDb ID와 영어/로마자/일본어 제목을 감지했습니다.

현재 페이지에는 외부 iframe 플레이어가 있습니다. 실제 재생·해당 서버의 내장 자막 추출·실제 모델의 번역 및 릴리즈 싱크를 끝까지 검증하지 않았습니다. 이 범위는 테스트용 Re:ANIME iframe, Miruro English TextTrack / HLS 단위 검사 및 progressive 브라우저 검사로 회귀 검증했습니다. 실제 현장 증거는 `qa/live-site-research.json`입니다.

## 알려진 제한

- Anissia 편성표에 없는 과거 작품은 이 경로에서 찾지 못할 수 있습니다.
- 개인 배포 페이지의 접근 권한이 없거나 로그인/JavaScript 다운로드가 필요하면 AUTO는 일본어/영어로 진행합니다. 필요한 도메인은 수동 Korean에서 승인할 수 있습니다.
- 미러 제목이나 파일명에서 회차·시즌을 확정할 수 없으면 적용하지 않습니다. 사이트 context가 일반 숫자 회차일 때 OVA/SP/Special을 추측해서 연결하지 않습니다.
- 원본 다운로드 캐시는 24시간입니다. 사이트가 같은 URL의 파일을 바꾸면 TTL 만료나 캐시 삭제 후 새 내용이 반영됩니다.
- browser service worker가 완전히 중단되면 기존과 같이 적용을 다시 실행하여 완료된 Chunk 캐시부터 복구합니다.
- ASS의 고급 스타일, closed shadow DOM player, 로그인 전용 배포 서비스, 전체 player origin별 실기기 동작은 보장하지 않습니다.
- 개발용 Vitest 3 계열에는 npm audit에서 중간 등급 2개 (동일 @vitest/mocker advisory의 직접/간접 항목)가 보고됩니다. 배포에 포함되지 않는 테스트 도구이며 runtime 의존성 검사 결과는 0개입니다. 테스트 도구 major 업그레이드는 이번 기능 개편에 포함하지 않았습니다.
- 배포 ZIP은 Chrome의 개발자 모드에서 로드하는 MV3 확장입니다. Chrome Web Store 자동 설치 패키지는 아닙니다.
