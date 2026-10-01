# Anime Korean Subtitle v0.4.2

Miruro / Re:ANIME의 현재 작품과 회차를 감지하고 한국어 자막을 준비하는 Chrome Manifest V3 확장프로그램입니다. 영상·오디오는 다운로드하거나 전사하지 않습니다.

## 다른 컴퓨터에 설치

1. [Releases](https://github.com/puruuun/anime-korean-subtitle-extension/releases)에서 `anime-korean-subtitle-v0.4.2.zip`을 받습니다.
2. ZIP을 폴더에 압축 해제합니다. 그 폴더의 `extension/manifest.json`을 확인합니다.
3. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램 로드**를 눌러 `extension` 폴더를 선택합니다.
5. 설정에서 **Local LLM** 또는 **Gemini API**를 연결합니다. 한국어 원본 자막에는 번역 서버가 필요 없습니다.
6. Miruro / Re:ANIME 회차를 열거나 새로고침합니다. 외부 플레이어·자막 CDN은 팝업의 **플레이어·자막 접근 허용**으로 해당 도메인만 승인합니다.

확장 폴더는 설치 후에도 삭제하지 마세요. 업데이트 때는 같은 폴더를 새 버전으로 바꾸고 확장 페이지에서 새로고침하세요. 로그인 정보·개인 API Key는 배포 ZIP에 포함하지 않습니다.

## 자동 / 수동

기본은 **자동**입니다. 영상이 감지되면 팝업을 열거나 적용 버튼을 누르지 않아도 시작합니다.

```text
Anissia 한국어 자막 → 바로 표시
         ↓ 실제 파일 해석/다운로드/파싱 실패
Jimaku 일본어 자막 → 한국어 점진 번역
         ↓ 키 없음, HTTP 오류, 회차 파일 없음, 파일 파싱 실패
Kitsunekko 미러 일본어 자막 → 한국어 점진 번역
         ↓ 실제 사용 가능한 회차 파일 없음
사이트 내장 영어 자막 → 한국어 점진 번역
```

후보가 발견됐다는 것만으로 성공하지 않습니다. 정확한 회차 파일을 다운로드하고 파싱해야 다음 단계를 생략합니다. 한국어 자막이 준비되면 AI를 호출하지 않습니다. 낮은 회차 신뢰도, 시즌 충돌, 다른 작품의 AniList ID는 자동 적용에서 제외합니다.

수동에는 다음 세 경로만 있습니다.

| 선택                           | 실행 경로                       |
| ------------------------------ | ------------------------------- |
| 한국어 자막 검색               | Anissia만 사용                  |
| 일본어 자막 검색 → 한국어 번역 | Jimaku → Kitsunekko만 사용      |
| 사이트 영어 자막 → 한국어 번역 | 외부 검색 없이 내장 영어만 사용 |

설정의 **자막 자동 검색 설정**에서 세 단계를 각각 끌 수 있습니다. 새 설치에서는 모두 켜져 있습니다. 자막 끄기/취소를 누르면 그 페이지에서는 자동으로 다시 시작하지 않습니다. 다음 회차를 열거나 적용 버튼을 누르면 다시 사용할 수 있습니다.

## 번역 엔진

- **Local LLM**: 기본 `http://127.0.0.1:1234/v1`. LM Studio 또는 OpenAI 호환 로컬 서버를 실행하고 모델을 로드한 다음 Model ID를 입력합니다. 원래 로컬 서버 설정은 업데이트 후 유지됩니다.
- **Gemini API**: Google AI Studio에서 발급받은 자신의 API Key를 입력합니다. **Test Connection**으로 계정에서 사용 가능한 Model ID를 확인하고 선택합니다. 일본어와 영어 모두 같은 선택 엔진을 사용하며 언어별 프롬프트는 분리합니다.

기존 `TranslationProvider`와 `TranslationQueue`를 재사용합니다. 처음 기본 20 Cue만 번역한 뒤 즉시 렌더러에 반영하고, 나머지는 기본 45 Cue씩 계속 번역합니다. 매 Chunk를 검증·IndexedDB에 저장하고 화면에 전달합니다. 회차 전환은 검색·다운로드·진행 중인 모델 요청을 취소하며, Seek는 해당 구간의 번역 우선순위를 높입니다.

번역 캐시 키에는 작품/회차, source (`anissia`, `jimaku`, `kitsunekko`, `embedded-en`), 원본 Cue hash, 언어, 엔진, endpoint, model, prompt version, Chunk 설정을 포함합니다. 같은 원본/엔진/설정으로 다시 적용하면 준비된 Chunk를 재사용합니다. 원본 다운로드 캐시는 24시간이며 서비스 파일이 변경되면 갱신 후 새 hash로 번역합니다.

## 자막 소스

### Anissia

별도 API Key가 없습니다. 실제 공개 API의 `{code:"ok",data:[...]}`와 bare array를 처리합니다. 0~8 편성표를 병합하고, 작품이 없으면 홈페이지의 전체 작품 검색 API(원제 토큰 및 페이지 처리)를 조회합니다. 정상 결과는 5분 캐싱합니다. 원제, 영어, 로마자, 한국어, 별칭과 시즌/Part/Cour/연도 정보를 확인하고 회차 caption을 찾습니다.

제작자별 최신 등록 회차가 현재 회차와 달라도 배포 페이지의 회차별 파일 또는 전체 ZIP을 확인합니다. 과거 회차는 파일명으로 해당 회차를 확인해야 적용합니다. 이전 TV 시즌 연결과 회차 수가 확인된 경우에만 시즌 회차와 누적 회차를 함께 허용합니다(예: 2기 12화 = 누적 24화).

`website`는 배포 페이지일 수 있습니다. SMI / SRT / ASS / SSA / VTT / ZIP, 정적 파일 링크와 공개 Google Drive 파일 링크를 해석합니다. Blogspot의 최신 글에 요청 회차가 없으면 공개 글 목록에서 같은 작품·시즌의 이전 회차 글을 찾습니다. 통합 ZIP은 내부 파일명으로 요청 회차를 선택하며, 오래된 한글 ZIP 파일명과 `Lv1 미완성.ass`, `작품명 2 01.ass` 형식도 확인합니다. 본문의 폰트 링크와 다른 작품·시즌의 검색 결과는 제외합니다.

배포 도메인은 수동 후보의 **접근 허용 후 적용**으로 승인할 수 있습니다. Blogspot 이후 Google Drive를 이용하면 `drive.usercontent.google.com` 파일 도메인도 같은 버튼으로 한 번 더 승인해야 할 수 있습니다. 권한이 없거나 회차를 확정할 수 없으면 배포 페이지와 원인을 안내하며, AUTO는 다음 소스로 진행합니다. 로그인 전용 파일, Drive 폴더, 다운로드 제한, JavaScript로 생성되는 링크는 지원하지 않을 수 있습니다. Blogspot 이전 글 검색은 최대 100개 결과로 제한합니다.

### Jimaku

고급 설정의 **Jimaku API Key**는 선택 사항입니다. 키가 없으면 조용히 Kitsunekko로 넘어갑니다. AniList ID가 있으면 우선 조회하며, ID가 없을 때 제목 별칭을 사용합니다. API의 best-effort 회차 결과를 그대로 믿지 않고 파일명을 다시 검증합니다. 401 / 403 / 429 / timeout / 서버 오류도 다음 소스로 진행합니다.

빌드 시 `JIMAKU_API_KEY` 환경변수 또는 로컬 `.env`를 사용할 수도 있습니다. 이 값은 service worker에만 삽입되며 팝업·설정·Content Script·MAIN bundle에는 포함되지 않습니다. 공개 배포는 키 없이 빌드하는 것이 기본입니다. 확장 파일에 삽입된 빌드 키는 배포 파일을 가진 사용자가 읽을 수 있습니다.

### Kitsunekko 미러

[Ajatt-Tools/kitsunekko-mirror](https://github.com/Ajatt-Tools/kitsunekko-mirror)의 [현재 HTML 카탈로그](https://subtitles.ajatt.top/)를 사용합니다. REST 자막 API로 가정하지 않습니다. 일본어/로마자/영어 작품명과 별칭을 카탈로그 행과 매칭하고 상세 페이지의 공식 GitHub 원본 파일 링크를 읽습니다. 카탈로그는 6시간 캐싱합니다.

SRT / ASS / SSA / VTT를 지원합니다. `01`, `E01`, `EP01`, `Episode 01`, `S01E01`, `12.5`를 보수적으로 인식합니다. OVA / SP / Special은 일반 회차와 섞지 않으며 context에 동일한 유형이 확인될 때만 사용합니다. 현재 사이트의 일반 회차 UI는 숫자 회차를 사용합니다. 숫자가 모호하거나 묶음 파일이면 자동 적용하지 않습니다.

## 보안과 권한

API 요청은 service worker에서 수행합니다. local/session storage는 `TRUSTED_CONTEXTS`로 제한하며 페이지·Content Script에 API Key나 전체 설정을 전달하지 않습니다. MAIN bridge는 기존 공개 자막 응답을 읽기만 합니다. 자막 다운로드는 쿠키 없이 수행하고 크기를 제한합니다.

필수 권한은 지원 사이트, Anissia, Jimaku, 미러 카탈로그/파일, Gemini, localhost로 제한합니다. 선택적 HTTP/HTTPS 권한은 사용자가 선택한 플레이어·자막·로컬 서버 도메인을 승인할 때만 사용합니다. 자동 한국어 단계 전체 10초(수동 한국어는 30초), 각 일본어 Provider 전체 8초, 내장 영어 단계 전체 10초를 넘기면 다음 경로로 진행합니다. 번역 timeout은 별도 설정입니다.

## 개발 및 검증

Node.js 22 이상을 권장합니다.

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run test:browser:progressive
npm run test:browser:anissia
npm run test:anissia:distribution
npm run test:browser:distribution
node scripts/browser-frames.mjs
node scripts/verify-services.mjs
node scripts/verify-live-provider.mjs
node scripts/research-live.mjs
```

`dist/`는 Chrome에 로드할 결과물입니다. `npm run check`는 typecheck, unit tests, build를 실행합니다. 브라우저 회귀 검사는 격리된 실제 MV3 확장과 모의 서비스/번역 응답을 사용합니다. Anissia 배포 형태 검사는 실제 Blogspot·Drive·티스토리 파일을 사용하며 `qa/anissia-distribution-report.json` 및 `qa/anissia-distribution-browser-report.json`에 기록합니다. 다른 실제 서비스 확인은 `qa/services-report.json`, 실제 페이지에서 실행한 두 Adapter 결과는 `qa/live-site-research.json`에 기록합니다. 상세 검증 범위와 제한은 [DEVELOPMENT.md](DEVELOPMENT.md)를 참고하세요.

자막 렌더러, 회차별 싱크, fullscreen, seek와 progressive buffer UI는 유지됩니다. ASS는 시간·대사 중심으로 처리하며 고급 스타일을 보존하지 않습니다. HLS는 WebVTT subtitle segment만 읽습니다.
