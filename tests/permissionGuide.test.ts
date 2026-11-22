import { describe, expect, it } from 'vitest';
import { getPermissionGuideCopy } from '../src/ui/permissionGuide';

function allTextValues(copy: ReturnType<typeof getPermissionGuideCopy>): string {
  return [
    copy.popupButtonLabel,
    copy.settingsButtonLabel,
    copy.step1Title,
    copy.step1Body,
    copy.step2Title,
    copy.step2Body,
    copy.step2ProfileNote,
    copy.privateModeTitle,
    copy.privateModeBody,
    copy.helpLabel,
    copy.helpUrl,
  ].join('\n');
}

describe('getPermissionGuideCopy', () => {
  it.each([true, false])('preserves exact legacy Chrome strings for personal=%s', (personal) => {
    const copy = getPermissionGuideCopy('chrome', personal);

    expect(copy.showManagerButton).toBe(true);
    expect(copy.popupButtonLabel).toBe('Chrome 권한 설정 열기');
    expect(copy.settingsButtonLabel).toBe('Chrome 사이트 접근 설정');
    expect(copy.step1Title).toBe('확장프로그램을 켭니다.');
    expect(copy.step2Title).toBe('사이트 액세스를 ‘모든 사이트에서’로 선택합니다.');
    expect(copy.privateModeTitle).toBe('시크릿 창에서도 보고 싶다면');
    expect(copy.privateModeBody).toContain('시크릿 모드에서 허용');
    expect(copy.helpLabel).toBe('Chrome 공식 확장프로그램 권한 안내 ↗');
    expect(copy.helpUrl).toBe('https://support.google.com/chrome/answer/2664769?hl=ko');
    if (personal) {
      expect(copy.step2ProfileNote).toContain('개인용 빌드');
    } else {
      expect(copy.step2ProfileNote).toContain('공개용 빌드');
    }
  });

  it.each([true, false])('returns Firefox guide without Chrome references for personal=%s', (personal) => {
    const copy = getPermissionGuideCopy('firefox', personal);
    const combined = allTextValues(copy);

    expect(copy.showManagerButton).toBe(true);
    expect(copy.popupButtonLabel).toBe('Firefox 부가 기능 설정 열기');
    expect(copy.settingsButtonLabel).toBe('Firefox 사이트 접근 설정');
    expect(copy.step1Body).toContain('about:addons');
    expect(copy.step2Body).toContain('모든 사이트 데이터 액세스 허용');
    expect(copy.privateModeTitle).toBe('사생활 보호 창에서도 보고 싶다면');
    expect(copy.privateModeBody).toContain('사생활 보호 창에서 실행 허용');
    expect(copy.helpLabel).toBe('Firefox 공식 부가 기능 권한 안내 ↗');
    expect(copy.helpUrl).toBe(
      'https://support.mozilla.org/ko/kb/permission-request-messages-firefox-extensions',
    );
    expect(combined).not.toContain('Chrome');
    if (personal) {
      expect(copy.step2ProfileNote).toContain('개인용 빌드');
    } else {
      expect(copy.step2ProfileNote).toContain('공개용 빌드');
    }
  });

  it.each([true, false])('returns Safari guide with showManagerButton=false and no Chrome references for personal=%s', (personal) => {
    const copy = getPermissionGuideCopy('safari', personal);
    const combined = allTextValues(copy);

    expect(copy.showManagerButton).toBe(false);
    expect(copy.popupButtonLabel).toBe('Safari 확장 프로그램 설정 확인');
    expect(copy.settingsButtonLabel).toBe('Safari 확장 프로그램 설정');
    expect(copy.step1Body).toContain('Safari');
    expect(copy.step1Body).toContain('WebVideoSubtitle');
    expect(copy.step2Body).toContain('모든 웹사이트 허용');
    expect(copy.step2Body).toContain('로컬 네트워크 접근 허용');
    expect(copy.privateModeTitle).toBe('개인정보 보호 브라우징에서 보고 싶다면');
    expect(copy.privateModeBody).toContain('개인정보 보호 브라우징에서 허용');
    expect(copy.helpLabel).toBe('Apple Safari 확장 프로그램 안내 ↗');
    expect(copy.helpUrl).toBe('https://support.apple.com/ko-kr/102343');
    expect(combined).not.toContain('Chrome');
    if (personal) {
      expect(copy.step2ProfileNote).toContain('개인용 빌드');
    } else {
      expect(copy.step2ProfileNote).toContain('공개용 빌드');
    }
  });
});
