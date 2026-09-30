# Implementation and verification

기준일: 2026-10-01 (Asia/Seoul). 이 문서는 구현과 자동 검증, 실제 서비스 현장 검증을 구분합니다.

## 단계별 체크포인트

| Phase | 구현                                                                                              | 단계 종료 확인                                                |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1     | MV3 / TS / Vite / React, video 탐지, Overlay, 명시적 테스트 자막                                  | typecheck / build 통과                                        |
| 2     | 두 SiteAdapter, URL / DOM / JSON-LD / 공개 메타데이터, 제목 정규화, SPA 탐지                      | typecheck / build, 4 tests 통과                               |
| 3     | SubtitleProvider, SubDL / OpenSubtitles, 점수·수동 후보, KO 모드, Parser / ZIP / 인코딩 / 캐시    | typecheck / build, 10 tests 통과                              |
| 4     | LM Studio / OpenAI-compatible, JA 모드, Chunk / Context / Structured response / Retry / IndexedDB | typecheck / build, 13 tests 통과                              |
| 5     | 읽기 전용 MAIN bridge, track / TextTrack / 공개 자막 응답 / HLS, EN 모드                          | typecheck / build 통과                                        |
| 6     | 독립 모드 이후 AUTO 추가, KO → JA → EN, 실패·모호한 결과 구분                                     | typecheck / build, 17 tests 통과                              |
| 7     | React 설정·Popup, iframe, document_start 등록, fullscreen / seek / offset, 작업 취소·cache 복구   | 최종 typecheck / build, 27 unit tests, 13 browser checks 통과 |

## 실제 사이트 조사

처음 네이티브 브라우저 도구와 기본 셸 샌드박스 초기화가 실패했습니다. 공개 HTML·현재 배포 번들을 먼저 읽고, 이후 설치된 Edge를 별도의 headless 프로필로 실행해 실제 DOM을 확인했습니다. 미디어 파일 요청은 차단했습니다.

### Miruro

현재 배포 진입 번들: `assets/index-C53ZC-L6.js`; watch 번들: `assets/WatchRoute-VOkDG4kF.js`.

- 실제 watch 경로: `/watch/{opaque-id}/{slug}?ep=1`
- 실제 제목 노드: `h1.title.anime-title`
- 번들에서 회차는 `searchParams.get("ep")`와 `episode_number`
- 작품 데이터는 `title.english / romaji / native`, `external_ids`
- 자막은 `subtitles[].file / language / label / format`를 player track으로 전달
- 공개 API 클라이언트: `/v1/anime/{id}`, `/v1/anime/{id}/episodes`
- 실제 DOM 검사에서 제목 **You and I Are Polar Opposites Season 2**, 회차 `ep=1`, `.anime-title`, iframe을 확인했습니다.
- URL의 opaque ID를 AniList ID라고 추측하지 않습니다.

### Re:ANIME

현재 SvelteKit 진입 번들: `assets/immutable/entry_app.hr-ewCYR.js`; watch 번들: `nodes_42.C4rxMco-.js`.

- 실제 경로 `/watch/{slug}?ep=1`, 활성 회차 `.ep-card.is-playing[data-episode]`
- JSON-LD `TVEpisode.episodeNumber / partOfSeries.name`
- SSR data의 작품 `title.english / romaji / native`, `anilist_id / mal_id / imdb_id / themoviedb_id`
- 공개 watch 요청 `/api/v1/watch/{slug}?ep={n}`
- 실제 player iframe `#video-player`
- 실제 DOM 검사에서 **Naruto - Episode 1**, TVEpisode와 `https://flixcloud.cc/e/...` 프레임을 확인했습니다.
- SSR 객체를 eval로 실행하지 않으며 알려진 메타데이터 필드만 읽습니다.

실제 조사 요약: `qa/live-site-research.json`. 소스 번들 문자열과 실제 DOM을 기반으로 구현했지만 모든 player 서버의 자막 엔진을 조사한 것은 아닙니다.

## 자동 검증

### 단위 테스트 27개

- 두 사이트의 확인된 DOM / JSON-LD / URL 필드와 회차 우선순위
- 제목 정규화, 없는 회차를 임의로 EP1로 처리하지 않는 동작
- SRT / VTT / ASS, HTML / ASS 텍스트 제거, 잘못된 포맷 / 인코딩
- 회차 불일치·회차 미확인 후보의 자동 적용 차단
- ZIP 회차 선택·모호한 파일 거부
- 문장 수·문자 수 Chunk 제한
- ID 누락 / 중복 / 추가 / 빈 번역 거부
- 타임코드 미전송·시간 보존·실패한 Chunk만 재시도
- 새 Cache 인스턴스의 IndexedDB 번역 재사용
- KO 모드 LLM 미호출, AUTO 순서와 API 인증 실패 시 중단
- HLS 영어 rendition과 WebVTT timestamp map
- 영상 currentTime / seek / pause / offset / clear / destroy
- English track 추출, 다운로드 실패 시 다음 자막 소스 사용, 번역 실패 시 중단
- 연결 실패·HTTP 인증 오류·사설 자막 URL 차단
- SubDL unpack 파일 및 OpenSubtitles parent ID / file_id 매핑
- SSE 조립과 미완료 스트림 거부

### 실제 MV3 브라우저 검사 13개

설치된 Edge를 **격리된 임시 프로필**로 실행했습니다. 실제 Service Worker, content script, MAIN bridge, React UI를 사용하고 외부 Provider는 모의 HTTPS 응답, 모델은 로컬 HTTP 서버로 대체했습니다.

`scripts/browser-test.mjs` / `qa/browser-report.json`:

1. KO 검색·다운로드·적용과 LLM 0회
2. JA 검색·검증된 번역·적용
3. EN track 번역과 외부 Provider 검색 0회
4. 번역 캐시로 LLM 재호출 0회
5. 페이지 DOM에 키 미노출
6. Offset 저장·적용
7. SPA EP1 → EP2 기존 상태 취소·새 회차 자동 적용
8. Settings /models 연결 검사

`scripts/browser-frames.mjs` / `qa/frame-report.json`:

1. Re:ANIME cross-origin video frame 주입
2. 실제 video frame으로 Cue 전달
3. 컨테이너 fullscreen에 Overlay 유지
4. 최신 CLEAR 이후 과거 APPLY 거부
5. ISOLATED content script의 키 저장소 접근 거부

headless 브라우저에서는 네이티브 권한 대화상자를 처리할 수 없어 프레임 테스트의 **임시 manifest 복사본**에 테스트 player origin을 미리 허용했습니다. 실제 배포 manifest의 optional permission 흐름은 수동 확인이 필요합니다.

스크린샷: `qa/popup.png`, `qa/settings.png`.

## 주요 설계 결정

- 모드 1 / 2 / 3은 독립 경로. AUTO만 검증된 NOT_FOUND에 따라 다음 경로로 이동합니다.
- 자동 적용은 언어·회차 및 제목 또는 ID 일치가 필요하며 시즌 충돌은 차단합니다.
- 사이트 DOM selector를 자막 Core나 Provider에 넣지 않았습니다.
- 자막 LLM 요청에는 시간 코드가 없으며 결과를 원본 ID에 다시 결합합니다.
- 원본 다운로드의 24시간 캐시와 원본 SHA-256에 따른 번역 캐시를 분리합니다.
- Cache key에 endpoint, model, prompt version, Context, Chunk 설정을 포함합니다.
- 읽기 전용 fetch 관찰은 원본 Promise / Response를 그대로 반환하고 clone만 읽습니다. 이전 페이지에서 시작한 늦은 fetch 응답은 배제합니다.
- iframe host 권한 승인 후 해당 도메인에 document_start 동적 주입을 등록합니다.
- Worker 상태는 session storage, 번역·다운로드는 IndexedDB, Offset은 trusted local storage에 저장합니다.
- Chrome Worker가 중단되면 사용자에게 재실행 안내를 표시하고 완료된 Chunk부터 복원합니다. 재시작 후 epoch를 유지해 오래된 Cue를 차단합니다.
- 로컬 모델의 긴 응답은 SSE로 받고 허용된 영상 페이지의 heartbeat가 작업 진행 중 Worker를 활성 상태로 유지합니다.
- 영상 자체 fullscreen은 브라우저의 native 한국어 TextTrack fallback을 사용합니다.

## 현장 검증 / 후속 범위

다음 항목은 사용자 설정 후 실제 서비스에서 확인해야 합니다.

- 두 사이트 × 세 모드에서 실제 작품·회차의 외부 자막 가용성
- 실제 SubDL / OpenSubtitles 계정의 API Key / Token / 서비스 한도
- 실제 LM Studio 모델의 자연스러운 한국어·이름 일관성
- 서버별 영상 릴리즈 Offset, 실제 영상의 10초 seek / 배속 / autoplay
- native browser permission 대화상자, video 자체 fullscreen의 브라우저 스타일
- 독자 player / closed shadow DOM, extensionless HLS 자막, timestamp discontinuity
- 자막 CDN이 iframe과 다른 origin일 때 접근 허용 및 추가 segment origin
- 큰 episode JSON 응답은 1 MiB 관찰 제한으로 일부 메타데이터를 읽지 않을 수 있음

ASS는 start / end / plain text 중심이며 고급 style은 보존하지 않습니다. HLS는 WebVTT subtitle 세그먼트를 처리합니다. 자막 export·고급 ASS 렌더링은 후속 기능입니다.

음성 인식 / Whisper / 오디오 추출·캡처·전사 / 영상 다운로드·재인코딩은 프로젝트 코드에 없습니다.

## 참고한 공식 자료

- [SubDL Search API](https://subdl.com/api-doc)
- [OpenSubtitles 공식 OpenAPI](https://stoplight.io/api/v1/projects/opensubtitles/opensubtitles-api/nodes/open_api.json)
- [OpenSubtitles Getting Started](https://opensubtitles.tawk.help/article/getting-started)
- [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)
- [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)
- [Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 작업 환경 문제

초기 Documents outputs 저장은 Windows 제어된 폴더 액세스(Defender 이벤트 1123)에 의해 차단됐습니다. 허용된 별도 작업 폴더에서 구현·검증했고, 사용자가 PowerShell의 폴더 접근을 허용한 뒤 지정된 outputs로 최종 결과물을 복사했습니다.
