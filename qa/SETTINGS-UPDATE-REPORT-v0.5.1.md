# v0.5.1 권한 가이드·GitHub 업데이트 확인

검증일: 2026-10-05 (KST). 사용자 Chrome은 조작하지 않았습니다. 개인용·공개용 설치 ZIP을 배포합니다.

## 변경 사항

설정의 기존 **Chrome 사이트 접근 설정** 링크 바로 아래에 설치 후 따라할 수 있는 가이드를 추가했습니다.

1. 확장 사용 켜기 및 세부정보 찾기.
2. 사이트 액세스 **모든 사이트에서** 선택. ‘선택 시’는 탭마다 클릭이 필요하다는 설명과 개인용/공개용 범위 구분.
3. AUTO 및 자동 적용 켜기, 설정 저장, 일본어·영어용 번역 서버 연결.
4. 기존 영상 페이지 새로고침, 작품·회차 선택, 상단 작업 상태 확인.

시크릿 모드의 별도 허용은 시크릿 창을 사용할 때만 안내합니다. 웹 영상 자막에 파일 URL·마이크·카메라 권한은 필요하지 않다고 설명합니다. [Chrome 공식 한국어 안내](https://support.google.com/chrome/answer/2664769?hl=ko)를 설정 안에서 열 수 있습니다.

**프로그램 업데이트**에는 설치 버전, GitHub 최신 정식 버전, 마지막 확인 시각, 직접 확인 버튼, Release 링크와 업데이트 설치 방법을 추가했습니다. `0.5.9 → 0.5.10`처럼 숫자 단위로 비교하며 최신/업데이트 필요/개발 버전/확인 실패를 구분합니다. 인증·HTTP 오류·오프라인·잘못된 Release를 최신 버전으로 표시하지 않습니다.

설정 진입 시 최신 Release endpoint를 조회하며 성공 결과는 10분, 실패 결과는 1분 캐싱합니다. 직접 확인 버튼은 캐시를 건너뜁니다. 동시 확인은 진행 중 요청 하나를 공유하며 10초 timeout으로 끝납니다. 설치 버전이 바뀌면 캐시를 새 설치 버전과 다시 비교합니다. 업데이트를 자동 설치하거나 사용자 Chrome의 확장을 교체하지는 않습니다.

## 비공개 저장소 인증과 권한

배포 전 실제 GitHub 조회로 저장소가 private이고 게시된 최신 정식 버전이 v0.5.0임을 확인했습니다. 새 Release의 latest 응답·태그·첨부파일 일치는 배포 단계에서 별도로 확인합니다. 비공개 Release API는 저장소 접근이 가능한 인증이 필요하므로 본인의 Fine-grained 토큰을 연결하는 가이드·생성 링크·연결/해제 기능을 넣었습니다. owner `puruuun`, 저장소 한 개 선택, **Contents: Read-only**를 안내합니다. Chrome의 GitHub 로그인 쿠키에 의존하지 않습니다. 저장소가 공개되면 토큰 없이 동작합니다. 근거: [GitHub Release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release), [토큰 관리 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

토큰은 일반 Settings 객체와 분리된 `chrome.storage.local`에 저장합니다. 저장소는 기존 `TRUSTED_CONTEXTS` 제한을 유지합니다. UI에는 저장된 토큰 대신 연결 여부만 반환하고, 연결 후 입력칸도 비웁니다. Content Script·웹페이지 및 일반 GET_SETTINGS 응답에는 전달하지 않습니다. GitHub의 고정된 API URL에만 Bearer 인증을 보내고 쿠키/리퍼러를 제외하며 redirect를 허용하지 않습니다. Release URL은 고정 저장소와 검증된 태그로 구성하고 서버가 제공한 외부 URL을 사용하지 않습니다. 토큰 변경은 기존 확인 요청을 취소하고 캐시를 비우며, 연결 해제는 토큰을 제거합니다.

공개용 manifest의 required host에 **`https://api.github.com/*`**만 추가했습니다. 개인용은 기존 required `<all_urls>`를 유지합니다. 업데이트 기능은 `chrome.permissions.request`를 호출하지 않습니다. Chrome 접근이 차단되면 권한 가이드를 안내하고 요청하지 않습니다. 기존 AUTO·플레이어·자막 처리 구조는 그대로 유지됩니다.

## 검증

- `npm run check`: typecheck, **212 unit tests**, 개인용 build 통과. 새 업데이트 unit tests는 32개입니다.
- `npm run build:public`: 공개용 build 통과.
- 개인용/공개용 새 프로필 설정 검사 **각 23개, 총 46개 통과**. 실제 MV3 worker/storage/UI와 GitHub 모의 응답·가짜 토큰을 사용했습니다. 첫 설치 가이드 위치/단계, 380px 화면, 저장되지 않은 설정 보존, 토큰 별도 저장, 최신/새 버전/개발 버전, 캐시/강제 확인/동시 요청, 인증 오류·요청 제한·오프라인·잘못된 Release·Chrome 접근 차단·연결 해제 및 확장 내부 통신 오류를 검증했습니다. runtime permission requests는 0회입니다.
- 기존 AUTO 회귀 검사: 개인용/공개용 **각 24개, 총 48개 통과**. Miruro/Re:ANIME 회차 변경, iframe 교체, 한국어→일본어→영어 fallback, 점진 번역, 캐시 재방문, 빠른 회차 이동과 이전 번역 취소, 재시도, 수동/AUTO 전환을 검증했습니다. runtime permission requests는 0회입니다.
- 이번 버전 브라우저 시나리오는 총 **94개**입니다. 이전 v0.5.0의 별도 검사 수는 합산하지 않았습니다.
- 실제 GitHub API는 인증된 `gh`로 private 여부·latest Release 응답·`2026-03-10` API 버전의 사용 가능 여부를 확인했습니다. 확장 UI에 실제 사용자 토큰을 넣는 검사는 하지 않았습니다.
- 개인용/공개용 스크립트가 동일하고 배포 빌드에 개인 키·테스트 토큰을 넣지 않았는지 확인했습니다. 새 권한은 공개용에만 명시됩니다.

근거 파일: `settings-updates-personal-report.json`, `settings-updates-public-report.json`, `auto-lifecycle-browser-report.json`, `auto-lifecycle-public-browser-report.json`, `build-security-v0.5.1.json`. 설정의 데스크톱/좁은 화면 캡처도 같은 `qa` 폴더에 있습니다.

## 제한과 설치

비공개 저장소에서 토큰을 연결하지 않으면 최신 여부를 판정할 수 없으므로 ‘확인 실패’와 연결 안내를 표시합니다. 토큰 계정의 저장소 접근·만료·권한에 따라 인증이 실패할 수 있습니다. 이때 자막 검색/번역은 독립적으로 동작합니다. 실제 Chrome의 설치 승인창·사이트 액세스 스위치를 직접 클릭하는 검사는 하지 않았습니다. 설치 권한은 격리 Chromium의 manifest/실제 grant로 확인하고 차단 분기는 모의 검사로 확인했습니다. 실제 원격 영상 재생이나 번역 모델 품질은 이번 설정 변경의 검증 범위에 포함하지 않습니다.

기본 개인용 ZIP을 풀고 `extension` 폴더를 Chrome에 로드하세요. 업데이트는 같은 빌드의 `extension` 내용으로 기존 폴더를 교체하고 Chrome 확장 새로고침 및 영상 새로고침을 진행합니다. 다른 컴퓨터에서는 저장소 접근이 있는 GitHub 계정으로 Release를 받을 수 있습니다. 사용자 직접 설치 선택을 유지했습니다.
