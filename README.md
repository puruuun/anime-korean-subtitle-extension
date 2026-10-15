# Anime Korean Subtitle v0.5.2

Miruro / Re:ANIME의 현재 작품과 회차를 감지하고 한국어 자막을 준비하는 Chrome Manifest V3 확장프로그램입니다. 영상·오디오는 다운로드하거나 전사하지 않습니다.

## 다른 컴퓨터에 설치

1. [Releases](https://github.com/puruuun/anime-korean-subtitle-extension/releases)에서 `anime-korean-subtitle-v0.5.2.zip`을 받습니다.
2. ZIP을 폴더에 압축 해제합니다. 그 폴더의 `extension/manifest.json`을 확인합니다.
3. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램 로드**를 눌러 `extension` 폴더를 선택합니다.
5. 설정에서 **Local LLM** 또는 **Gemini API**를 연결합니다. 한국어 원본 자막에는 번역 서버가 필요 없습니다.
6. Miruro / Re:ANIME 회차를 열거나 새로고침합니다. 회차 선택만으로 자막 검색·다운로드·번역·적용이 자동 실행됩니다.

기본 ZIP은 **개인용** 빌드입니다. 설치 시 모든 웹사이트 접근 권한(`<all_urls>`)을 사용하며 재생 중 별도의 권한 창을 요청하지 않습니다. 제한된 권한이 필요하면 `anime-korean-subtitle-public-v0.5.2.zip`을 사용하세요. 공개용의 알려지지 않은 배포·플레이어·번역 서버는 재생 전에 설정의 초기 접근 설정에서 한 번 승인합니다. AUTO가 대신 권한 창을 띄우지 않습니다.

확장 폴더는 설치 후에도 삭제하지 마세요. 업데이트 때는 같은 폴더를 새 버전으로 바꾸고 확장 페이지에서 새로고침하세요. 로그인 정보·개인 API Key는 배포 ZIP에 포함하지 않습니다.

## 처음 설치한 뒤 권한 설정

설정의 **초기 접근 설정 → Chrome 사이트 접근 설정** 바로 아래에 따라할 수 있는 가이드를 넣었습니다.

1. Chrome 확장 세부정보에서 확장 사용 스위치를 켭니다.
2. **사이트 액세스 → 모든 사이트에서**를 선택합니다. ‘선택 시’는 탭마다 클릭이 필요하므로 AUTO에는 맞지 않습니다. 공개용의 ‘모든 사이트’는 선언된 지원 host 범위이며, 개인용은 모든 웹사이트를 허용합니다. 개별 허용 스위치가 표시되면 모두 켭니다.
3. 이 프로그램 설정으로 돌아와 **자동**과 **작품·회차 선택 시 자동 적용**을 켜고 **설정 저장**을 누릅니다. 일본어·영어 번역을 사용하려면 번역 서버를 연결하고 연결 테스트를 진행합니다.
4. 열려 있던 Miruro / Re:ANIME 영상 페이지를 새로고침하고 회차를 선택합니다. 팝업 상단 작업 상태창에서 진행을 확인합니다.

시크릿 창을 사용할 때만 **시크릿 모드에서 허용**도 켜세요. 일반 웹 영상에는 파일 URL·마이크·카메라 권한이 필요하지 않습니다. [Chrome 공식 권한 안내](https://support.google.com/chrome/answer/2664769?hl=ko)도 설정에서 열 수 있습니다.

## GitHub 업데이트 확인

설정의 **프로그램 업데이트**에서 설치 버전과 최신 정식 Release를 비교합니다. 설정을 열면 확인하며, 성공 결과는 10분 동안 재사용합니다. **업데이트 확인** 버튼은 캐시를 건너뛰고 다시 조회합니다. **최신 버전 / 업데이트 필요 / 개발 버전 / 확인 실패**를 구분하며 인증·통신 실패를 최신 버전으로 표시하지 않습니다. 실패 결과는 1분간만 캐싱합니다. 같은 시점의 요청은 하나로 합치고 10초 안에 응답하지 않으면 중단합니다.

현재 GitHub 저장소가 **비공개**이므로 업데이트 조회에는 해당 저장소에 접근할 수 있는 본인의 **Fine-grained 읽기 전용 토큰**이 필요합니다. Chrome의 GitHub 로그인만으로 API가 인증되지는 않습니다. 설정의 **비공개 저장소 연결**을 펼치면 생성 링크와 다음 절차가 있습니다.

1. GitHub 토큰 생성 화면에서 이름·만료일을 정합니다.
2. Resource owner `puruuun`, Only select repositories → `anime-korean-subtitle-extension`을 선택합니다. 목록에 없으면 계정의 저장소 접근 권한을 확인하세요.
3. Repository permissions에서 **Contents: Read-only**를 선택합니다. Metadata 읽기는 자동 포함됩니다. 쓰기 권한은 필요 없습니다.
4. 생성한 토큰을 입력하고 **연결하고 확인**을 누릅니다. 연결 해제로 토큰을 제거할 수 있습니다.

토큰은 현재 Chrome 프로필의 확장 local storage에 별도로 저장하며 GitHub API에만 전송합니다. 웹페이지·Content Script 및 일반 설정 응답에 반환하지 않습니다. 저장소가 공개되면 토큰 없이 조회할 수 있습니다. [GitHub 토큰 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [Release API 권한 문서](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).

새 버전이 있으면 Release 링크와 설치 방법을 표시합니다. 같은 빌드의 ZIP을 받고 기존 설치 폴더를 교체한 다음 Chrome 확장 페이지의 새로고침(↻)과 영상 새로고침을 진행합니다. 업데이트 파일을 자동 설치하는 기능은 아닙니다.

## 자동 / 수동

신규 설치 기본값은 **자동 + 자동 적용 켜짐**입니다. 팝업을 열거나 실행 버튼을 누르지 않아도 시작합니다. 기존에 직접 선택한 수동 설정은 유지되므로 업데이트 후 자동을 원하면 **자동 전환**을 누르세요.

상단 작업 상태창은 고정되어 현재 작품·회차, 찾는 중/다운로드/번역/재시도, Source, 재생 시각과 번역 완료 시각을 표시합니다. 수동 전환은 작업 중에도 가능하며 이전 검색·다운로드·번역과 예약된 재시도를 취소합니다. AUTO에는 **다시 검색 / 번역 재시작**만 있고 수동 실행은 명시적으로 수동 모드를 선택했을 때만 제공합니다.

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

설정의 **자막 자동 검색 설정**에서 세 단계를 각각 끌 수 있습니다. 새 설치에서는 모두 켜져 있습니다. 자막 끄기/취소를 누르면 그 페이지에서는 자동으로 다시 시작하지 않습니다. 다음 회차를 열거나 다시 검색을 누르면 다시 사용할 수 있습니다.

## 한국어 + 일본어 원문 동시 표시

팝업 또는 설정에서 **일본어 원문 함께 보기**를 켜세요. 한국어 아래에 일본어 원문을 추가 표시합니다. 신규 설치와 기존 설정의 기본값은 꺼짐입니다. 설정의 **추가 자막**에서 일본어 글자 크기(기본 22px)와 일본어 추가 싱크(-10~10초)를 조절할 수 있습니다. 추가 싱크는 공통 한국어 싱크에 더해지며 양수는 일본어를 먼저, 음수는 늦게 표시합니다. 설정 저장과 팝업 스위치는 현재 영상에 즉시 반영되고 한국어 검색·번역을 다시 실행하지 않습니다.

일본어 → 한국어 번역 중에는 이미 받은 일본어 원문을 재사용합니다. Anissia 한국어를 쓰는 경우에는 한국어를 먼저 적용하고 Jimaku → Kitsunekko → 사이트 내장 일본어 순으로 추가 자막을 찾습니다. AUTO가 일본어를 찾지 못해 영어 번역으로 넘어간 경우에는 같은 외부 검색을 반복하지 않고 내장 일본어만 확인합니다. 일본어를 못 찾아도 한국어는 계속 표시하며 상태창에 이유를 표시합니다. 일본어가 없을 때 번역으로 일본어를 만들어내지는 않습니다.

각 언어의 실제 Cue 시간으로 표시하므로 파일마다 대사 ID나 줄 나눔이 달라도 함께 볼 수 있습니다. 두 자막은 회차 캐시에 함께 보관하며 다음 회차로 이동하거나 옵션을 끄면 진행 중인 일본어 요청을 취소합니다. 플레이어/iframe 교체와 확장 백그라운드 재시작 후에도 저장된 상태로 옵션을 적용합니다. 컨테이너 전체화면에서는 두 줄을 그대로 유지하고, video 요소 자체의 전체화면은 Chrome 기본 자막 Cue에 두 언어를 합칩니다. 기본 자막 표시에서는 개별 일본어 글꼴 크기가 적용되지 않을 수 있습니다.

## 작업 경과 시간

검색·다운로드·번역·예약된 재시도·플레이어 준비 대기·추가 일본어 검색이 진행 중일 때만 경과 시간을 계산합니다. 남은 작업이 없으면 완료/오류/중단 시각에 멈추고 **종료**를 표시합니다. 이후 재생 시각이 바뀌거나 팝업을 다시 열어도 완료 시간이 늘어나지 않습니다. 완료 후 추가 검색을 시작하면 이전 작업 시간에 새 작업 시간만 더하고 중간에 쉬었던 시간은 제외합니다. 일본어·영어 번역 화면에도 작업 경과를 표시합니다.

## 회차 감지·재시도·캐시

공통 `EpisodeLifecycleManager`가 pushState / replaceState / popstate / DOM·player 변경을 감지합니다. 작품 ID·시즌·회차를 포함한 key와 400ms 안정성 확인으로 중복 실행을 막고 회차 이동 시 즉시 이전 작업을 중단합니다. 전체 페이지 이동도 취소합니다. 같은 회차의 플레이어 교체는 저장된 렌더러 상태만 복원합니다.

실패한 AUTO 검색·번역은 3초 → 6초 → 12초 → 20초 → 20초 간격으로 최대 6회 실행합니다. 새 재시도 시작은 회차 진입 후 2분 이내로 제한합니다. 플레이어는 준비될 때까지 1초 간격으로 확인하며 DOM에 나타나면 즉시 반응합니다. 잘못된 번역 설정/접근 차단은 반복 재시도하지 않습니다. 이미 진행 중인 정상 번역은 계속 진행됩니다.

24시간 회차 캐시를 네트워크 검색보다 먼저 적용합니다. 완료 자막은 재방문 시 검색·다운로드·모델 호출을 생략하고, 부분 번역은 원본 Cue와 완료 Chunk를 복원한 뒤 누락 구간만 이어갑니다. **다시 검색**은 회차 캐시를 건너뛰며 기존 원본/Chunk 캐시는 계속 사용할 수 있습니다.

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

Blogspot·티스토리·Google Drive 배포 host는 공개용에서도 필수 설치 권한입니다. 개인용에서는 새 외부 host도 추가 승인 없이 읽습니다. 공개용에서 미리 승인하지 않은 host가 필요하면 배포 페이지와 원인을 안내하고 다음 소스로 진행합니다. 모든 경로가 실패하면 설정 확인을 안내하며 권한 요청을 반복하지 않습니다. 로그인 전용 파일, Drive 폴더, 다운로드 제한, JavaScript로 생성되는 링크는 지원하지 않을 수 있습니다. Blogspot 이전 글 검색은 최대 100개 결과로 제한합니다.

### Jimaku

고급 설정의 **Jimaku API Key**는 선택 사항입니다. 키가 없으면 조용히 Kitsunekko로 넘어갑니다. AniList ID가 있으면 우선 조회하며, ID가 없을 때 제목 별칭을 사용합니다. API의 best-effort 회차 결과를 그대로 믿지 않고 파일명을 다시 검증합니다. 401 / 403 / 429 / timeout / 서버 오류도 다음 소스로 진행합니다.

빌드 시 `JIMAKU_API_KEY` 환경변수 또는 로컬 `.env`를 사용할 수도 있습니다. 이 값은 service worker에만 삽입되며 팝업·설정·Content Script·MAIN bundle에는 포함되지 않습니다. 공개 배포는 키 없이 빌드하는 것이 기본입니다. 확장 파일에 삽입된 빌드 키는 배포 파일을 가진 사용자가 읽을 수 있습니다.

### Kitsunekko 미러

[Ajatt-Tools/kitsunekko-mirror](https://github.com/Ajatt-Tools/kitsunekko-mirror)의 [현재 HTML 카탈로그](https://subtitles.ajatt.top/)를 사용합니다. REST 자막 API로 가정하지 않습니다. 일본어/로마자/영어 작품명과 별칭을 카탈로그 행과 매칭하고 상세 페이지의 공식 GitHub 원본 파일 링크를 읽습니다. 카탈로그는 6시간 캐싱합니다.

SRT / ASS / SSA / VTT를 지원합니다. `01`, `E01`, `EP01`, `Episode 01`, `S01E01`, `12.5`를 보수적으로 인식합니다. OVA / SP / Special은 일반 회차와 섞지 않으며 context에 동일한 유형이 확인될 때만 사용합니다. 현재 사이트의 일반 회차 UI는 숫자 회차를 사용합니다. 숫자가 모호하거나 묶음 파일이면 자동 적용하지 않습니다.

## 보안과 권한

API 요청은 service worker에서 수행합니다. local/session storage는 `TRUSTED_CONTEXTS`로 제한하며 페이지·Content Script에 API Key나 전체 설정을 전달하지 않습니다. MAIN bridge는 기존 공개 자막 응답을 읽기만 합니다. 자막 다운로드는 쿠키 없이 수행하고 크기를 제한합니다.

개인용 빌드는 required `<all_urls>`이며 optional host와 `activeTab`을 사용하지 않습니다. 공개용 required host는 지원 사이트, 실제 확인된 `strm.cx` / `flixcloud.cc`, Anissia·Jimaku·미러·Gemini·localhost, Blogspot·티스토리·Google Drive 및 업데이트 확인용 `api.github.com`입니다. 공개용에만 optional HTTP/HTTPS를 남겨 초기 설정에서 알려지지 않은 host를 승인할 수 있습니다. `chrome.permissions.request`는 초기 설정 helper에만 남아 있으며 AUTO와 팝업에는 없습니다. Chrome이 필수 접근을 차단하면 확장 세부정보를 안내하고 자동 권한 요청은 하지 않습니다. 자동 한국어 단계 전체 10초(수동 한국어는 30초), 각 일본어 Provider 전체 8초, 내장 영어 단계 전체 10초를 넘기면 다음 경로로 진행합니다. 번역 timeout은 별도 설정입니다.

## 개발 및 검증

Node.js 22 이상을 권장합니다.

```sh
npm ci
npm run build:personal # 기본 설치 ZIP용
npm run build:public   # 제한된 설치 권한용
npm run check
npx playwright install chromium
npm run test:browser
npm run test:browser:auto
npm run test:browser:dual
npm run test:browser:settings
npm run test:browser:progressive
npm run test:browser:anissia
npm run test:anissia:distribution
npm run test:browser:distribution
node scripts/browser-frames.mjs
node scripts/verify-services.mjs
node scripts/verify-live-provider.mjs
node scripts/research-live.mjs
```

`dist/`는 Chrome에 로드할 결과물입니다. `npm run check`는 typecheck, unit tests, build를 실행합니다. 브라우저 회귀 검사는 격리된 실제 MV3 확장과 모의 서비스/번역 응답을 사용합니다. Anissia 배포 형태 검사는 실제 Blogspot·Drive·티스토리 파일을 사용하며 `qa/anissia-distribution-report.json` 및 `qa/anissia-distribution-browser-report.json`에 기록합니다. 다른 실제 서비스 확인은 `qa/services-report.json`, 실제 페이지에서 실행한 두 Adapter 결과는 `qa/live-site-research.json`에 기록합니다. 이번 권한/AUTO 개편의 상세 결과는 [qa/AUTO-UX-REPORT-v0.5.0.md](qa/AUTO-UX-REPORT-v0.5.0.md)를 참고하세요. 권한 가이드·업데이트 확인 기능의 v0.5.1 검증은 [qa/SETTINGS-UPDATE-REPORT-v0.5.1.md](qa/SETTINGS-UPDATE-REPORT-v0.5.1.md)를 참고하세요. 작업 시간 정지·동시 자막의 v0.5.2 검증은 [qa/DUAL-SUBTITLE-REPORT-v0.5.2.md](qa/DUAL-SUBTITLE-REPORT-v0.5.2.md)를 참고하세요. 상세 검증 범위와 제한은 [DEVELOPMENT.md](DEVELOPMENT.md)를 참고하세요.

자막 렌더러, 회차별 싱크, fullscreen, seek와 progressive buffer UI는 유지됩니다. ASS는 시간·대사 중심으로 처리하며 고급 스타일을 보존하지 않습니다. HLS는 WebVTT subtitle segment만 읽습니다.
