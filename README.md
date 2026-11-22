# Web Video Subtitle Extension

**한국어** | [English](README.en.md)

웹 영상 사이트에서 원하는 언어의 자막을 지원하지 않을 때, **외부 자막 자동 검색·점진적 AI 번역·원문 동시 자막 오버레이**를 제공하는 크로스 브라우저 Manifest V3 확장프로그램입니다.

> 영상·오디오 스트림은 다운로드하거나 전사하지 않고, 텍스트 기반 자막 파일만 처리합니다.

---

## 주요 기능

- **자동 자막 확보 파이프라인**: 작품·회차를 자동 감지해 외부 자막을 우선 적용하고, 없을 때만 AI 번역으로 폴백합니다.
- **점진적 AI 번역**: 첫 구간을 빠르게 번역해 재생을 시작하고, 나머지는 재생 중 백그라운드에서 이어서 번역합니다(Seek 시 해당 구간 우선 처리).
- **원문 동시 자막**: 한국어 자막 아래에 일본어 원문을 함께 표시하며, 글꼴 크기와 추가 싱크를 독립 조절할 수 있습니다.
- **싱크 조절 & 단축키**: 회차별 싱크 자동 저장 및 플레이어 키보드 단축키 지원.
- **로컬 / 클라우드 번역 엔진**: Local LLM(LM Studio / OpenAI 호환 API)과 Gemini API 모두 지원.

---

## 설치 방법

[Releases](https://github.com/puruuun/web-video-subtitle-extension/releases)에서 환경에 맞는 빌드 ZIP을 내려받습니다.

| 빌드 | 파일명 | 권한 범위 | 추천 대상 |
| :--- | :--- | :--- | :--- |
| **개인용 (권장)** | `anime-korean-subtitle-v0.5.5.zip` | `<all_urls>` | 재생 중 추가 권한 요청 없이 바로 사용 |
| **공개용** | `anime-korean-subtitle-public-v0.5.5.zip` | 선언 호스트 + 선택적 승인 | 최소 권한으로 필요한 도메인만 수동 승인 |

1. ZIP 압축을 해제하고 내부 `extension/manifest.json` 폴더를 확인합니다.
2. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램 로드**를 눌러 `extension` 폴더를 선택합니다.
4. 확장 세부정보에서 **사이트 액세스 → 모든 사이트에서**를 선택한 뒤, 설정에서 번역 엔진(필요 시)을 연결합니다.

---

## 자막 확보 흐름 (AUTO)

```text
외부 한국어 자막 (Anissia → 웹 한국어 폴백 검색)
        ↓ 미등록 또는 회차 파일 확보 실패
외부 일본어 자막 (Jimaku → Kitsunekko 미러) → AI 점진 번역
        ↓ 사용 가능한 파일 없음
플레이어 내장 영어 자막 → AI 점진 번역
```

- 한국어 원본 자막이 확보되면 번역 API를 호출하지 않습니다.
- 수동 모드에서는 한국어 검색 / 일본어 검색 후 번역 / 내장 영어 번역을 개별 실행할 수 있습니다.

---

## 단축키

| 단축키 | 동작 |
| :--- | :--- |
| `Alt + [` | 자막 싱크 `-0.5s` |
| `Alt + ]` | 자막 싱크 `+0.5s` |
| `Alt + \` | 자막 싱크 초기화 (`0.0s`) |
| `Alt + J` | 일본어 원문 동시 자막 켜기/끄기 |

---

## 지원 현황 및 확장 방향

- **지원 브라우저**: Chrome / Edge / Brave(데스크톱), Firefox(데스크톱 · Android), Safari(macOS · iOS Web Extension)
- **현재 지원 사이트**: Miruro, Re:ANIME (+ `flixcloud.cc`, `strm.cx` 임베드 플레이어) 기반 한국어 자막 및 일본어 원문 동시 자막
- **확장 예정**: 더 다양한 웹 비디오 사이트 어댑터 및 사용자 지정 타겟 언어(다국어 자막) 지원 확대

---

## 보안 및 프라이버시

- 모든 외부 API 요청은 Service Worker에서 처리하며, API Key·토큰은 `TRUSTED_CONTEXTS` 확장 스토리지에만 격리 저장됩니다.
- Content Script·웹페이지 DOM·콘솔로 자격증명을 전달하지 않습니다.
- 텍스트 자막(`.srt`, `.ass`, `.ssa`, `.smi`, `.vtt`, WebVTT HLS)과 자막 ZIP만 처리합니다.

---

## 개발 및 빌드

Node.js 22 이상을 권장합니다.

```bash
npm ci
npm run check                  # typecheck + unit tests + build
npm run build:personal         # Chrome 개인용 빌드 (dist/)
npm run build:public           # Chrome 공개용 빌드 (dist/)
npm run build:firefox:personal # Firefox (데스크톱/Android) 개인용 빌드
npm run build:safari:personal  # Safari (macOS/iOS) 개인용 빌드
```

Firefox `.xpi` 및 iOS Safari Unsigned `.ipa` 패키지는 GitHub Actions의 `Build Mobile Packages (Firefox & iOS Safari)` 워크플로우에서 자동 생성할 수 있습니다.

상세 검증 이력 및 기술 메모는 [DEVELOPMENT.md](DEVELOPMENT.md)를 참고하세요.
