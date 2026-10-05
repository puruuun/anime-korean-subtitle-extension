import React, { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../background/updates';
import { RELEASES_URL } from '../../background/updates';
import { send } from '../api';

export function ExtensionUpdates() {
  const [status, setStatus] = useState<UpdateStatus>({
    state: 'unchecked',
    currentVersion: chrome.runtime.getManifest().version,
    releaseUrl: RELEASES_URL,
    message: 'GitHub 최신 Release를 확인합니다.',
  });
  const [busy, setBusy] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState('');
  function failed(e: unknown) {
    setStatus({
      state: 'error',
      currentVersion: chrome.runtime.getManifest().version,
      releaseUrl: RELEASES_URL,
      checkedAt: Date.now(),
      message: e instanceof Error ? e.message : '업데이트를 확인하지 못했습니다. 다시 확인하세요.',
    });
  }
  async function check(force: boolean) {
    const response = await send<{ status: UpdateStatus }>({ type: 'CHECK_UPDATES', force });
    setStatus(response.status);
  }
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const connection = await send<{ tokenConfigured: boolean }>({ type: 'UPDATE_CONNECTION' });
        const response = await send<{ status: UpdateStatus }>({ type: 'CHECK_UPDATES' });
        if (mounted) {
          setConfigured(connection.tokenConfigured);
          setStatus(response.status);
        }
      } catch (e) {
        if (mounted) failed(e);
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  async function action(nextToken?: string) {
    setBusy(true);
    try {
      if (nextToken !== undefined) {
        const connection = await send<{ tokenConfigured: boolean }>({
          type: 'SAVE_UPDATE_TOKEN',
          token: nextToken,
        });
        setConfigured(connection.tokenConfigured);
        setToken('');
      }
      await check(true);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    unchecked: '확인 전',
    latest: '최신 버전',
    available: '업데이트 필요',
    ahead: '개발 버전',
    error: '확인 실패',
  };
  return (
    <section className="extension-updates" aria-labelledby="updates-title">
      <h2 id="updates-title">프로그램 업데이트</h2>
      <p className="muted">
        설정을 열면 GitHub 최신 정식 Release와 비교합니다. 직접 확인 버튼은 항상 새로 조회합니다.
      </p>
      <div
        className="update-status"
        role="status"
        aria-live="polite"
        aria-busy={busy}
        data-state={busy ? 'checking' : status.state}
      >
        <strong
          className={
            status.state === 'error' ? 'error' : status.state === 'latest' ? 'success' : ''
          }
        >
          {busy ? '업데이트 확인 중…' : labels[status.state]}
        </strong>
        <p>{status.message}</p>
        <dl className="update-versions">
          <div>
            <dt>설치된 버전</dt>
            <dd>v{status.currentVersion}</dd>
          </div>
          <div>
            <dt>GitHub 최신 버전</dt>
            <dd>{status.latestVersion ? 'v' + status.latestVersion : '확인하지 못함'}</dd>
          </div>
        </dl>
        {status.checkedAt && (
          <small>
            마지막 확인: {new Date(status.checkedAt).toLocaleString('ko-KR')}
            {status.cached ? ' · 저장된 확인 결과' : ''}
          </small>
        )}
      </div>
      <div className="update-actions">
        <button disabled={busy} onClick={() => void action()}>
          {busy ? '확인 중…' : '업데이트 확인'}
        </button>
        <a href={status.releaseUrl} target="_blank" rel="noreferrer">
          GitHub Release 열기 ↗
        </a>
      </div>
      {status.state === 'available' && (
        <div className="guide-note">
          <strong>새 버전 설치 방법</strong>
          <ol>
            <li>Release에서 사용 중인 빌드와 같은 개인용 또는 공개용 ZIP을 받습니다.</li>
            <li>
              ZIP의 extension 폴더 내용으로 기존 설치 폴더를 교체합니다. 폴더 경로를 유지하면 기존
              설정을 이어서 사용합니다.
            </li>
            <li>
              위 Chrome 설정 링크를 열어 확장프로그램의 새로고침(↻) 버튼을 누른 뒤 영상 페이지도
              새로고침합니다.
            </li>
          </ol>
          <p>버전 확인 기능입니다. 설치 파일을 자동으로 설치하지는 않습니다.</p>
        </div>
      )}
      <details className="update-connection">
        <summary>비공개 저장소 연결 · {configured ? '토큰 연결됨' : '연결 안내'}</summary>
        <p>
          현재 저장소는 비공개이므로 저장소 접근이 가능한 본인의 GitHub 읽기 전용 토큰이 필요합니다.
          Chrome에서 GitHub에 로그인하는 것만으로는 API 인증이 되지 않습니다. 저장소가 공개되면 토큰
          없이 확인할 수 있습니다.
        </p>
        <ol>
          <li>
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              GitHub 토큰 만들기 ↗
            </a>
            를 열고 로그인합니다. Fine-grained token의 이름과 만료일을 정합니다.
          </li>
          <li>
            Resource owner는 <strong>puruuun</strong>, Repository access는{' '}
            <strong>Only select repositories</strong>로 선택하고{' '}
            <strong>anime-korean-subtitle-extension</strong>을 지정합니다. 저장소가 목록에 없다면
            해당 계정의 저장소 접근 권한부터 확인하세요.
          </li>
          <li>
            Repository permissions에서 <strong>Contents → Read-only</strong>를 추가합니다. Metadata
            읽기는 자동 포함됩니다. 쓰기 권한은 필요 없습니다.
          </li>
          <li>
            Generate token으로 생성한 값을 아래에 붙여 넣고 <strong>연결하고 확인</strong>을
            누릅니다. 이 토큰은 현재 Chrome 프로필의 확장 저장소에만 저장되며 GitHub 업데이트
            조회에만 사용합니다.
          </li>
        </ol>
        <label>
          업데이트 조회용 GitHub 토큰
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            placeholder={configured ? '저장된 토큰 있음 · 교체하려면 새 토큰 입력' : 'github_pat_…'}
            disabled={busy}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <div className="update-actions">
          <button disabled={busy || !token.trim()} onClick={() => void action(token.trim())}>
            연결하고 확인
          </button>
          {configured && (
            <button className="secondary" disabled={busy} onClick={() => void action('')}>
              토큰 연결 해제
            </button>
          )}
        </div>
        <p>
          <a
            href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
            target="_blank"
            rel="noreferrer"
          >
            GitHub 공식 토큰 안내 ↗
          </a>
        </p>
      </details>
    </section>
  );
}
