import type { BrowserFamily } from '../platform/browser';

export interface PermissionGuideCopy {
  popupButtonLabel: string;
  settingsButtonLabel: string;
  showManagerButton: boolean;
  step1Title: string;
  step1Body: string;
  step2Title: string;
  step2Body: string;
  step2ProfileNote: string;
  privateModeTitle: string;
  privateModeBody: string;
  helpLabel: string;
  helpUrl: string;
}

export function getPermissionGuideCopy(
  family: BrowserFamily,
  personal: boolean,
): PermissionGuideCopy {
  if (family === 'firefox') {
    return {
      popupButtonLabel: 'Firefox 부가 기능 설정 열기',
      settingsButtonLabel: 'Firefox 사이트 접근 설정',
      showManagerButton: true,
      step1Title: '부가 기능을 활성화합니다.',
      step1Body:
        '위 버튼(또는 주소창의 about:addons)에서 부가 기능 관리 화면을 엽니다. 목록에서 Anime Korean Subtitle을 선택해 사용 스위치를 켜세요. Firefox Android에서는 메뉴 → 확장 프로그램 → 확장 프로그램 관리에서 선택합니다.',
      step2Title: '권한 탭에서 모든 사이트 데이터 액세스를 허용합니다.',
      step2Body:
        '세부정보의 권한 탭에서 모든 사이트의 데이터에 액세스(Firefox Android: 권한 → 모든 사이트 데이터 액세스 허용)를 켜세요. 사이트 접근이 제한되면 자동 자막이 시작되지 않습니다.',
      step2ProfileNote: personal
        ? '개인용 빌드는 영상 플레이어·외부 자막 배포 사이트·번역 서버를 읽기 위해 모든 웹사이트 접근이 필요합니다.'
        : '공개용 빌드에서는 선언된 지원 사이트와 추가 허용한 외부 도메인에 대한 권한을 켜야 합니다. 새 외부 도메인은 위 ‘초기 접근 등록’으로 한 번 등록합니다.',
      privateModeTitle: '사생활 보호 창에서도 보고 싶다면',
      privateModeBody:
        '부가 기능 세부정보의 사생활 보호 창에서 실행 허용 옵션을 ‘허용’으로 선택하세요. 일반 창만 쓰면 필요 없습니다.',
      helpLabel: 'Firefox 공식 부가 기능 권한 안내 ↗',
      helpUrl: 'https://support.mozilla.org/ko/kb/permission-request-messages-firefox-extensions',
    };
  }

  if (family === 'safari') {
    return {
      popupButtonLabel: 'Safari 확장 프로그램 설정 확인',
      settingsButtonLabel: 'Safari 확장 프로그램 설정',
      // iOS Safari extensions cannot open iOS Settings URLs directly; show inline guide instead.
      showManagerButton: false,
      step1Title: 'Safari 확장 프로그램을 켭니다.',
      step1Body:
        'iOS 설정 → 앱 → Safari → 확장 프로그램 → WebVideoSubtitle 켜기 순서로 활성화하세요. macOS Safari에서는 Safari → 설정 → 확장 프로그램에서 체크박스를 켭니다.',
      step2Title: '‘모든 웹사이트 허용’을 선택합니다.',
      step2Body:
        '확장 프로그램 설정에서 모든 웹사이트 허용을 선택하세요. 일부 사이트만 허용하면 자막 검색이나 번역이 동작하지 않을 수 있습니다. LAN Local LLM을 사용하는 경우 iOS의 "로컬 네트워크 접근 허용" 팝업도 반드시 허용해야 합니다.',
      step2ProfileNote: personal
        ? '개인용 빌드는 영상 플레이어·외부 자막 배포 사이트·번역 서버를 읽기 위해 모든 웹사이트 접근이 필요합니다.'
        : '공개용 빌드에서도 지원 사이트와 외부 자막·번역 도메인 접근을 허용해야 정상 동작합니다. 새 외부 도메인은 위 ‘초기 접근 등록’으로 한 번 등록합니다.',
      privateModeTitle: '개인정보 보호 브라우징에서 보고 싶다면',
      privateModeBody:
        'Safari 확장 설정의 개인정보 보호 브라우징에서 허용을 추가로 켜세요. 일반 브라우징만 쓰면 필요 없습니다.',
      helpLabel: 'Apple Safari 확장 프로그램 안내 ↗',
      helpUrl: 'https://support.apple.com/ko-kr/102343',
    };
  }

  return {
    popupButtonLabel: 'Chrome 권한 설정 열기',
    settingsButtonLabel: 'Chrome 사이트 접근 설정',
    showManagerButton: true,
    step1Title: '확장프로그램을 켭니다.',
    step1Body:
      '위 링크를 누르면 이 확장프로그램의 세부정보가 열립니다. 사용 스위치를 켜세요. 목록 화면이 열렸다면 Anime Korean Subtitle 카드의 세부정보를 누릅니다.',
    step2Title: '사이트 액세스를 ‘모든 사이트에서’로 선택합니다.',
    step2Body:
      '세부정보의 사이트 액세스(또는 사이트 접근)에서 모든 사이트에서를 선택하세요. ‘선택 시’는 탭마다 확장을 눌러야 하므로 자동 자막이 시작되지 않습니다.',
    step2ProfileNote: personal
      ? '개인용 빌드는 영상 플레이어·외부 자막 배포 사이트·번역 서버를 읽기 위해 모든 웹사이트 접근이 필요합니다.'
      : '공개용 빌드에서 ‘모든 사이트에서’는 manifest에 선언된 지원 사이트에 모두 허용한다는 뜻입니다. 목록에 개별 허용 스위치가 표시되면 모두 켜세요. 새 외부 도메인은 위 ‘초기 접근 등록’으로 한 번 등록합니다.',
    privateModeTitle: '시크릿 창에서도 보고 싶다면',
    privateModeBody:
      'Chrome 세부정보에서 시크릿 모드에서 허용을 추가로 켜세요. 일반 창만 쓰면 필요 없습니다. 웹 영상 자막에는 ‘파일 URL에 대한 액세스 허용’이 필요하지 않습니다.',
    helpLabel: 'Chrome 공식 확장프로그램 권한 안내 ↗',
    helpUrl: 'https://support.google.com/chrome/answer/2664769?hl=ko',
  };
}
