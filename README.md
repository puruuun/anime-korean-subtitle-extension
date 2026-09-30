# Anime Korean Subtitle Translator Extension

Miruro / Re:ANIME에서 외부 한국어·일본어 자막 또는 플레이어 영어 자막을 사용하는 Chrome Manifest V3 확장프로그램입니다. TypeScript / Vite / React 기반이며 Chrome 120 이상을 대상으로 합니다.

## 바로 설치하기

1. `anime-korean-subtitle-extension.zip`을 압축 해제합니다.
2. Chrome의 `chrome://extensions`에서 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. `manifest.json`이 들어 있는 `anime-korean-subtitle-extension` 폴더를 선택합니다.
5. Miruro / Re:ANIME 영상 페이지를 새로고침합니다.
6. 확장 버튼 → **설정**에서 사용하는 자막 Provider API Key와 번역 서버를 입력합니다.

이 확장프로그램은 Chrome 웹 스토어에 배포되지 않은 로컬 개발 버전입니다.

## 자막 모드

| 모드                 | 원본                                                   | LLM 사용    | 다른 모드로 자동 이동 |
| -------------------- | ------------------------------------------------------ | ----------- | --------------------- |
| 한국어 자막 검색     | SubDL / OpenSubtitles 한국어 파일                      | 없음        | 없음                  |
| 일본어 → 한국어      | SubDL / OpenSubtitles 일본어 파일                      | 있음        | 없음                  |
| 사이트 영어 → 한국어 | 플레이어의 영어 track / TextTrack / 관찰한 자막 리소스 | 있음        | 없음                  |
| 자동 선택            | 한국어 → 일본어 → 사이트 영어                          | 필요한 경우 | 검색 결과가 없을 때만 |

AUTO는 인증 실패, 다운로드 실패, 번역 실패, 모호한 검색 결과를 “자막 없음”으로 처리하지 않습니다. 모호한 후보는 직접 선택해야 합니다. 잘못된 회차나 시즌, 회차 정보가 없는 후보는 자동 적용하지 않습니다.

**한국어 자막 적용**으로 시작합니다. 정보가 잘못 잡혔다면 **정보 수정**에서 작품명·시즌·회차를 변경합니다. 작품명을 바꾸면 잘못 매칭된 ID를 제거하고 다시 검색합니다.

한 번 적용한 뒤 회차가 바뀌면 같은 모드로 다시 처리합니다. **자막 끄기 / 취소**는 표시·번역·다음 회차 자동 처리를 중단합니다.

## LM Studio / OpenAI 호환 서버

- Base URL: 서버의 API 루트. 예: `http://127.0.0.1:1234/v1`
- API Key: 서버가 요구하는 경우 입력
- Model ID: 서버의 정확한 모델 식별자
- **Test Connection**: `GET /models`로 연결과 모델 존재를 확인
- **설정 저장**: 설정과 해당 서버 접근 권한 저장

번역은 `POST {baseUrl}/chat/completions`를 사용합니다. 포트·주소·모델은 고정하지 않습니다. 긴 로컬 번역은 SSE 스트리밍으로 처리하며 표준 JSON 응답도 읽습니다. JSON Schema를 지원하지 않는 서버는 **JSON Object** 또는 **JSON Prompt만 사용**을 선택하세요. 선택한 형식과 관계없이 결과 ID·개수·빈 번역을 검증합니다.

첫 Chunk 기본값은 20 Cue, 다음 Chunk는 45 Cue / 5,000자, 이전 Context 5 Cue, Temperature 0.2, Timeout 120초, 재시도 2회입니다. 처음부터 긴 자막을 보내기 전에 연결을 확인하세요.

LLM에는 `{id,text}`와 이전 대사만 전송합니다. 원본의 시작·종료 시간은 프로그램이 보존합니다. 실패한 Chunk만 재시도하며 완료한 Chunk는 IndexedDB에 저장합니다.

## 점진적 번역과 재생 버퍼 (v0.2.0)

전체 자막을 먼저 파싱한 뒤 첫 Chunk는 기본 20개 Cue, 다음 Chunk는 기본 45개 Cue로 나눕니다. 문자 수 제한도 함께 적용합니다. 첫 Chunk가 끝나면 즉시 한국어 자막을 추가하고, 나머지는 Service Worker에서 한 번에 한 Chunk씩 번역합니다.

- 일반 모드: 원래 재생 중인 영상은 첫 Chunk를 준비하는 동안만 잠시 멈추고 준비되면 이어서 재생합니다. 사용자가 직접 선택한 일시정지는 유지합니다.
- 즉시 재생 모드: 재생을 멈추지 않습니다. 플레이어에서 선택한 기존 영어 자막은 현재 위치의 한국어가 준비되면 자동 전환되고, 미번역 위치로 seek하면 다시 원본 자막을 사용할 수 있습니다.
- 목표 Buffer는 기본 300초입니다. 현재 재생 위치와 그 뒤 5분의 미번역 Chunk를 우선하고, 이후에도 남은 회차 전체를 끝까지 처리합니다.
- seek하면 새 위치 주변 Chunk의 우선순위를 높이고 관련 없는 진행 중 요청은 AbortController로 취소합니다. 취소한 Chunk는 pending으로 돌아갑니다.
- Chunk 상태는 pending / translating / completed / failed입니다. 실패한 Chunk만 지정 횟수만큼 재시도하며 다른 구간의 완료 자막은 계속 사용할 수 있습니다.
- 각 완료 Chunk는 IndexedDB에 저장한 뒤 메모리 자막 Store와 Renderer에 즉시 추가됩니다. 다시 적용하면 완료된 Chunk를 재사용하고 빠진 구간만 번역합니다.
- v0.1.0의 검증된 전체 회차 캐시도 새 Chunk 형식으로 변환해 재사용합니다. 이전 버전의 부분 캐시는 Chunk 경계와 Context 키가 달라 다시 번역할 수 있습니다.
- Popup과 영상 Overlay에 번역 상태, 현재 재생 시각, 연속 번역 완료 위치와 Buffer를 표시합니다. 미번역 구간 뒤의 완료 자막을 연결된 Buffer로 계산하지 않습니다.
- SPA 회차 전환과 취소는 이전 API 요청·Queue·표시를 중단하고 새 epoch의 회차 Queue를 시작합니다.

300초는 유지하려는 목표입니다. 첫 Chunk 직후, 큰 seek 직후 또는 모델 번역 속도가 재생을 따라가지 못하면 실제 Buffer는 그보다 짧을 수 있습니다. Buffer가 부족하다고 영상 재생을 전체 번역 완료까지 막지는 않습니다. 짧은 영상은 남은 재생 길이까지만 확보할 수 있습니다.

이미 설치한 버전은 Chrome의 chrome://extensions에서 확장프로그램을 새로고침한 뒤 영상 페이지도 새로고침하세요. 설정에서 첫 Chunk 크기(15~25개), 목표 Buffer(60~1800초), 즉시 재생을 조정할 수 있습니다.

## 자막 Provider

### SubDL

Settings에 SubDL API Key를 입력합니다. 문서화된 v1 검색 API를 사용하며 한국어 `KO`, 일본어 `JA`, 회차·시즌, 작품 ID와 제목 후보로 검색합니다. 묶음 자막은 가능한 경우 Provider가 제공하는 회차별 파일을 사용합니다.

### OpenSubtitles

API Key와 Token 또는 Username / Password를 입력합니다. **로그인 / Token 저장**으로 인증할 수 있습니다. 로그인 응답이 지정한 일반 / VIP 서버를 사용합니다. 다운로드에는 유효한 사용자 인증과 서비스의 다운로드 한도가 필요합니다.

작은 Priority 숫자가 우선입니다. 작품명만 일치한다고 자동 적용하지 않으며 회차 정보가 반드시 확인되어야 합니다.

## iframe / 사이트 영어 자막

두 사이트의 현재 재생 페이지는 외부 iframe을 사용할 수 있습니다.

1. 영상 플레이어가 나타난 뒤 확장 버튼을 엽니다.
2. **플레이어·자막 접근 허용** 버튼이 있으면 해당 도메인의 접근을 허용합니다.
3. 사이트를 새로고침해 초기 자막 API 응답을 관찰하게 합니다.
4. 사이트 플레이어에서 **English** 자막을 선택하고 원하는 모드를 실행합니다.

허용한 플레이어 도메인은 다음 방문부터 MAIN / ISOLATED 스크립트를 `document_start`에 주입합니다. 상위 페이지는 작품 정보를, 실제 video 프레임은 자막 표시를 담당합니다. 플레이어나 CDN 도메인이 변경되면 해당 도메인 권한이 추가로 필요할 수 있습니다.

영어 자막은 track → TextTrack → 공개 플레이어 / 자막 응답 → 자막 URL → HLS subtitle rendition 순으로 읽습니다. HLS는 WebVTT 텍스트 세그먼트를 지원합니다. 영상·오디오 세그먼트나 DRM 자막은 처리하지 않습니다.

## 표시 / 싱크

글자 크기, 아래 위치, 배경 불투명도, Outline, 최대 줄 수를 설정합니다. 영상의 `currentTime + offset`으로 Cue를 표시합니다.

- `−0.5s` / `Reset` / `+0.5s`
- 범위: −10 ~ +10초
- 양수 Offset은 자막을 앞당깁니다.
- 작품·시즌·회차별로 저장합니다.
- 컨테이너 전체화면은 Overlay, video 자체 전체화면은 별도 한국어 TextTrack을 사용합니다.
- video 자체 전체화면의 세부 스타일은 브라우저 자막 설정을 따를 수 있습니다.

## 캐시

다운로드와 번역 캐시는 확장프로그램 소유 IndexedDB에 보관합니다. 다운로드는 24시간 뒤 다시 확인합니다. 번역 캐시는 작품·시즌·회차·언어·원본 SHA-256·서버·모델·프롬프트 버전·Chunk / Context 설정을 구분합니다.

브라우저를 재시작해도 같은 자막의 번역을 재사용합니다. Worker가 중단되어도 **한국어 자막 적용**을 다시 누르면 완료된 Chunk를 캐시에서 복구합니다. 원본 자막이 변경됐거나 새로 받아야 하면 Settings에서 **자막 캐시 비우기**를 사용하세요.

## 소스에서 빌드

Node.js 22.12 이상 또는 24 LTS를 권장합니다.

```sh
npm install
npm run typecheck
npm test
npm run build
```

이 작업 환경에서는 다음 명령을 실제 검증했습니다.

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm build
```

빌드 결과는 `dist/`입니다. 번들에는 외부 JavaScript 로딩과 eval이 없습니다.

브라우저 통합 테스트:

```sh
# Windows에서는 설치된 Edge의 격리된 테스트 프로필 사용
npm run test:browser

# iframe / fullscreen 별도 검증
node scripts/browser-frames.mjs

# 다른 환경은 Playwright Chromium 설치 후 실행
npx playwright install chromium
```

`ANIMESUB_BROWSER_CHANNEL`로 첫 번째 브라우저 테스트의 Chrome / Edge 채널을 지정할 수 있습니다. 프레임 테스트는 headless 권한 대화상자 제한 때문에 **테스트 복사본에만** 테스트 플레이어 도메인을 미리 허용합니다. 배포 manifest의 권한은 변경하지 않습니다.

## 구조

- `src/sites/miruro`, `src/sites/reanime`: 실제 사이트 DOM / 메타데이터 Adapter
- `src/anime`: 공통 AnimeContext, 제목 후보, ID 보강
- `src/providers`: SubDL / OpenSubtitles 인터페이스와 구현
- `src/subtitle`: 검색 평가, Parser, ZIP, Overlay, HLS, 모드 처리
- `src/translation`: Provider, Chunk, 프롬프트, ID 검증, 번역 캐시
- `src/background`: API 호출, 신뢰된 메시지 처리, frame 전달
- `src/content`: 영상·SPA 탐지, 읽기 전용 페이지 bridge
- `src/ui`: React Popup / Settings
- `tests`, `qa`: 자동 검증과 브라우저 검사 결과

## 보안과 처리 범위

API Key / Token / Password는 확장프로그램의 로컬 저장소에 보관합니다. `TRUSTED_CONTEXTS`로 Content Script 접근을 차단하고 설정·번역 요청은 확장 UI만 시작할 수 있게 합니다. API 호출은 Service Worker에서 수행합니다. 페이지 bridge는 필요한 공개 메타데이터와 자막 주소만 전달합니다. 로그에는 키·URL·요청 본문·자막 본문을 기록하지 않습니다.

음성 인식, Whisper, 오디오 캡처·추출·전사, 영상 다운로드·재인코딩 기능은 구현하지 않았습니다. VTT export는 후속 기능입니다.

## 확인된 상태와 남은 현장 검증

구현·빌드와 자동 검증은 완료했습니다. 단위 테스트 59개와 모의 Provider / 로컬 모델을 사용하는 브라우저 검사 22개가 통과했습니다. 실제 Miruro / Re:ANIME의 현재 DOM과 공개 번들도 조사했습니다.

**사용자 API Key와 실제 LM Studio 모델이 제공되지 않았으므로 실제 Provider의 자막 가용성, 계정 한도, 실제 작품의 번역 품질과 릴리즈 싱크는 현장 검증이 남아 있습니다.** 브라우저 권한 대화상자 승인, player의 closed shadow DOM / 독자 자막 엔진, HLS timestamp discontinuity는 플레이어별 확인이 필요합니다. 사이트가 DOM / API를 변경하면 Adapter나 자막 탐지 규칙을 갱신해야 할 수 있습니다.

검사 범위와 실제 조사 근거는 `DEVELOPMENT.md`를 참고하세요.

## GitHub 저장소

비공개 저장소: [puruuun/anime-korean-subtitle-extension](https://github.com/puruuun/anime-korean-subtitle-extension)

전체 소스는 저장소 루트에 있고, 설치용 ZIP은 releases/anime-korean-subtitle-extension.zip에 있습니다. 소스에서 다시 빌드하면 dist/ 폴더를 Chrome에 로드할 수 있습니다.
