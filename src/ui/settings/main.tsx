import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSettings, type Settings } from '../../storage/settings';
import { send, requestHost } from '../api';
import { ExtensionUpdates } from './ExtensionUpdates';
import '../style.css';
function SettingsPage() {
  const [s, setS] = useState<Settings>(structuredClone(defaultSettings));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [extraHost, setExtraHost] = useState('');
  const personal = chrome.runtime.getManifest().host_permissions?.includes('<all_urls>');
  useEffect(() => {
    void send<{ settings: Settings }>({ type: 'GET_SETTINGS' }).then(
      (r) => setS(r.settings),
      (e) => setError(e.message),
    );
  }, []);
  function translation<K extends keyof Settings['translation']>(
    key: K,
    value: Settings['translation'][K],
  ) {
    setS({ ...s, translation: { ...s.translation, [key]: value } });
  }
  async function action(fn: () => Promise<void>) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const t = s.translation;
  return (
    <main className="settings">
      <h1>설정</h1>
      <section>
        <h2>자막 실행</h2>
        <div className="row">
          <label className="mode">
            <input
              name="subtitleMode"
              type="radio"
              checked={s.mode === 'auto'}
              onChange={() => setS({ ...s, mode: 'auto' })}
            />
            자동
          </label>
          <label className="mode">
            <input
              name="subtitleMode"
              type="radio"
              checked={s.mode !== 'auto'}
              onChange={() => setS({ ...s, mode: 'ko' })}
            />
            수동
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoApply}
            onChange={(e) => setS({ ...s, autoApply: e.target.checked })}
          />
          작품·회차 선택 시 자동 적용
        </label>
        <p className="muted">
          자동은 자막 검색과 번역을 바로 시작합니다. 수동을 선택하면 팝업에서 사용할 경로를 직접
          실행합니다.
        </p>
      </section>
      <section>
        <h2>초기 접근 설정</h2>
        <p className="muted">
          {personal
            ? '개인용 빌드: 설치 시 모든 웹사이트 접근을 승인합니다. 영상·자막 처리 중 추가 승인창을 요청하지 않습니다.'
            : '공개용 빌드: 지원 사이트·확인된 플레이어·자막 소스의 접근은 설치 권한에 포함됩니다. 다른 외부 도메인은 여기서 한 번 등록하세요.'}
        </p>
        {!personal && (
          <>
            <label>
              추가 배포·플레이어 도메인
              <input
                type="url"
                value={extraHost}
                onChange={(e) => setExtraHost(e.target.value)}
                placeholder="https://example.com"
              />
            </label>
            <button
              className="secondary"
              disabled={busy || !extraHost.trim()}
              onClick={() =>
                void action(async () => {
                  await requestHost(extraHost.trim());
                  setMessage('외부 도메인의 접근 설정을 저장했습니다.');
                })
              }
            >
              초기 접근 등록
            </button>
          </>
        )}
        <button
          className="text-button"
          onClick={() =>
            chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id })
          }
        >
          Chrome 사이트 접근 설정
        </button>
        <div className="permission-guide">
          <h3>처음 설치한 뒤 이렇게 설정하세요</h3>
          <ol>
            <li>
              <strong>확장프로그램을 켭니다.</strong>
              <p>
                위 링크를 누르면 이 확장프로그램의 세부정보가 열립니다. 사용 스위치를 켜세요. 목록
                화면이 열렸다면 Anime Korean Subtitle 카드의 <strong>세부정보</strong>를 누릅니다.
              </p>
            </li>
            <li>
              <strong>사이트 액세스를 ‘모든 사이트에서’로 선택합니다.</strong>
              <p>
                세부정보의 <strong>사이트 액세스</strong>(또는 사이트 접근)에서{' '}
                <strong>모든 사이트에서</strong>를 선택하세요. ‘선택 시’는 탭마다 확장을 눌러야
                하므로 자동 자막이 시작되지 않습니다.
              </p>
              <p>
                {personal
                  ? '개인용 빌드는 영상 플레이어·외부 자막 배포 사이트·번역 서버를 읽기 위해 모든 웹사이트 접근이 필요합니다.'
                  : '공개용 빌드에서 ‘모든 사이트에서’는 manifest에 선언된 지원 사이트에 모두 허용한다는 뜻입니다. 목록에 개별 허용 스위치가 표시되면 모두 켜세요. 새 외부 도메인은 위 ‘초기 접근 등록’으로 한 번 등록합니다.'}
              </p>
            </li>
            <li>
              <strong>여기서 자동 자막을 켜고 저장합니다.</strong>
              <p>
                이 설정 탭으로 돌아와 맨 위의 <strong>자동</strong>과{' '}
                <strong>작품·회차 선택 시 자동 적용</strong>을 켭니다. 아래{' '}
                <strong>설정 저장</strong>을 누르세요. 한국어 원본이 없는 작품은 번역 서버에서 Local
                LLM 또는 Gemini API를 연결하고 연결 테스트도 진행합니다.
              </p>
            </li>
            <li>
              <strong>열려 있던 영상 페이지를 새로고침합니다.</strong>
              <p>
                Miruro / Re:ANIME에서 작품과 회차를 선택하세요. 확장 버튼을 누르지 않아도
                검색·번역이 시작됩니다. 진행 상황은 팝업 맨 위의 작업 상태창에서 확인할 수 있습니다.
              </p>
            </li>
          </ol>
          <div className="guide-note">
            <strong>시크릿 창에서도 보고 싶다면</strong>
            <p>
              Chrome 세부정보에서 <strong>시크릿 모드에서 허용</strong>을 추가로 켜세요. 일반 창만
              쓰면 필요 없습니다. 웹 영상 자막에는 ‘파일 URL에 대한 액세스 허용’이 필요하지
              않습니다.
            </p>
          </div>
          <p className="muted">
            저장소·탭·플레이어 처리 권한은 설치에 포함됩니다. 별도의 마이크·카메라 권한은 필요
            없습니다. 권한을 바꾼 뒤에는 영상 페이지를 새로고침하세요.
          </p>
          <a
            href="https://support.google.com/chrome/answer/2664769?hl=ko"
            target="_blank"
            rel="noreferrer"
          >
            Chrome 공식 확장프로그램 권한 안내 ↗
          </a>
        </div>
      </section>
      <ExtensionUpdates />
      <section>
        <div className="section-title">
          <span className="number">01</span>
          <h2>번역 서버</h2>
        </div>
        <div className="grid">
          <label>
            Translation Engine
            <select
              value={t.provider}
              onChange={(e) => translation('provider', e.target.value as typeof t.provider)}
            >
              <option value="lmstudio">Local LLM (LM Studio)</option>
              <option value="gemini">Gemini API</option>
            </select>
          </label>
          {t.provider !== 'gemini' && (
            <label>
              출력 형식
              <select
                value={t.structured}
                onChange={(e) => translation('structured', e.target.value as typeof t.structured)}
              >
                <option value="json_schema">JSON Schema (엄격)</option>
                <option value="json_object">JSON Object</option>
                <option value="none">JSON Prompt만 사용</option>
              </select>
            </label>
          )}
        </div>
        {t.provider !== 'gemini' && (
          <label>
            Base URL
            <input
              type="url"
              value={t.baseUrl}
              placeholder="http://127.0.0.1:1234/v1"
              onChange={(e) => translation('baseUrl', e.target.value)}
            />
          </label>
        )}
        <div className="grid">
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={t.provider === 'gemini' ? t.geminiApiKey : t.apiKey}
              onChange={(e) =>
                translation(t.provider === 'gemini' ? 'geminiApiKey' : 'apiKey', e.target.value)
              }
            />
          </label>
          <label>
            Model ID
            <input
              value={t.provider === 'gemini' ? t.geminiModel : t.model}
              list="models"
              onChange={(e) =>
                translation(t.provider === 'gemini' ? 'geminiModel' : 'model', e.target.value)
              }
            />
            <datalist id="models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await requestHost(
                t.provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : t.baseUrl,
              );
              const r = await send<{ models: string[] }>({ type: 'TEST_CONNECTION', settings: s });
              setModels(r.models);
              setMessage('연결 성공 · ' + r.models.length + '개 모델');
            })
          }
        >
          Test Connection
        </button>
        <p className="muted">
          {t.provider === 'gemini'
            ? '연결 테스트로 사용 가능한 Gemini 모델을 확인하세요. 일본어와 영어에 같은 엔진을 사용합니다.'
            : '서버의 /v1 경로를 포함하세요. OpenAI 호환 로컬 서버도 지원합니다. JSON Schema를 지원하지 않는 모델은 출력 형식을 변경하세요.'}
        </p>
      </section>
      <section>
        <div className="section-title">
          <span className="number">02</span>
          <h2>자막 자동 검색 설정</h2>
        </div>
        {(
          [
            ['anissia', 'Anissia 한국어 자막 우선 검색'],
            ['japaneseTranslation', '일본어 자막 검색 후 AI 번역'],
            ['embeddedEnglish', '사이트 영어 자막 fallback'],
          ] as const
        ).map(([key, label]) => (
          <label className="check" key={key}>
            <input
              type="checkbox"
              checked={s.autoSources[key]}
              onChange={(e) =>
                setS({ ...s, autoSources: { ...s.autoSources, [key]: e.target.checked } })
              }
            />
            {label}
          </label>
        ))}
        <p className="muted">
          자동 모드는 켜진 단계만 순서대로 사용합니다. 한국어 자막은 번역 없이 표시합니다.
        </p>
        <details>
          <summary>고급 설정</summary>
          <label>
            Jimaku API Key (선택)
            <input
              type="password"
              autoComplete="off"
              value={s.jimaku.apiKey}
              onChange={(e) => setS({ ...s, jimaku: { apiKey: e.target.value } })}
            />
          </label>
          <small>키가 없거나 요청이 실패하면 Kitsunekko 미러에서 계속 검색합니다.</small>
          <a href="https://jimaku.cc/api/docs" target="_blank" rel="noreferrer">
            Jimaku API 안내 ↗
          </a>
        </details>
      </section>
      <section>
        <div className="section-title">
          <span className="number">03</span>
          <h2>번역과 표시</h2>
        </div>
        <div className="grid">
          {(
            [
              { key: 'initialChunkSize', label: '첫 Chunk 크기 (Cue)', min: 15, max: 25 },
              { key: 'chunkSize', label: '이후 Chunk 크기 (Cue)', min: 1, max: 60 },
              { key: 'targetBufferSeconds', label: '목표 번역 Buffer (초)', min: 60, max: 1800 },
              { key: 'maxCharacters', label: '최대 문자 수', min: 100, max: 6000 },
              { key: 'contextCues', label: '이전 Context Cue', min: 0, max: 20 },
              { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1 },
              { key: 'timeoutMs', label: '요청 Timeout (ms)', min: 1000, max: 240000 },
              { key: 'maxRetry', label: '재시도 횟수', min: 0, max: 5 },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={'step' in f ? f.step : 1}
                value={t[f.key]}
                onChange={(e) => translation(f.key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={t.immediatePlayback}
            onChange={(e) => translation('immediatePlayback', e.target.checked)}
          />
          즉시 재생 모드
        </label>
        <p className="muted">
          기본 모드는 첫 작은 Chunk의 한국어 자막만 준비한 뒤 재생합니다. 즉시 재생 모드는 영어
          자막으로 먼저 재생하고, 첫 한국어 Chunk가 준비되면 자동으로 전환합니다.
        </p>
        <p className="muted">
          이후 Chunk는 재생 중 계속 번역합니다. 목표 Buffer는 현재 위치보다 앞서 준비할 번역
          구간이며, 기본값은 300초입니다. 서버 속도에 따라 일시적으로 부족할 수 있습니다.
        </p>
        <hr />
        <h3>추가 자막</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={s.display.showJapanese}
            onChange={(e) =>
              setS({ ...s, display: { ...s.display, showJapanese: e.target.checked } })
            }
          />
          일본어 원문 함께 보기
        </label>
        <p className="muted">
          한국어 위주로 보면서 아래에 일본어 원문을 함께 표시합니다. 일본어 번역 원문은 재사용하고,
          한국어 원본을 쓰는 경우에는 일본어 자막을 별도로 찾습니다. 일본어를 찾지 못해도 한국어는
          계속 표시합니다. 저장하면 현재 영상에도 적용됩니다.
        </p>
        <div className="grid">
          <label>
            일본어 글자 크기 (px)
            <input
              type="number"
              min="12"
              max="72"
              value={s.display.japaneseFontSize}
              onChange={(e) =>
                setS({ ...s, display: { ...s.display, japaneseFontSize: Number(e.target.value) } })
              }
            />
          </label>
          <label>
            일본어 추가 싱크 (초)
            <input
              type="number"
              min="-10"
              max="10"
              step="0.1"
              value={s.display.japaneseOffset}
              onChange={(e) =>
                setS({ ...s, display: { ...s.display, japaneseOffset: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <p className="muted">
          일본어 추가 싱크는 한국어 싱크에 더해집니다. 양수는 일본어를 먼저, 음수는 늦게 표시합니다.
          일본어를 따로 켜거나 꺼도 한국어 검색·번역을 다시 실행하지 않습니다.
        </p>
        <div className="grid">
          {(
            [
              { key: 'fontSize', label: '글자 크기 (px)', min: 12, max: 72, step: 1 },
              { key: 'bottom', label: '아래에서의 위치 (%)', min: 0, max: 50, step: 1 },
              { key: 'backgroundOpacity', label: '배경 불투명도', min: 0, max: 1, step: 0.05 },
              { key: 'outline', label: 'Outline (px)', min: 0, max: 6, step: 0.5 },
              { key: 'maxLines', label: '최대 표시 줄 수', min: 1, max: 8, step: 1 },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={s.display[f.key]}
                onChange={(e) =>
                  setS({ ...s, display: { ...s.display, [f.key]: Number(e.target.value) } })
                }
              />
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={s.debug}
            onChange={(e) => setS({ ...s, debug: e.target.checked })}
          />
          개발 로그 표시 (API Key / 자막 본문 제외)
        </label>
        <div
          className="subtitle-preview"
          style={{
            fontSize: s.display.fontSize,
            background: 'rgba(0,0,0,' + s.display.backgroundOpacity + ')',
            textShadow: '0 0 ' + s.display.outline + 'px black',
          }}
        >
          자막 표시 미리보기
          {s.display.showJapanese && (
            <div style={{ fontSize: s.display.japaneseFontSize, color: '#d7e7ff', marginTop: 6 }}>
              日本語の字幕を一緒に表示
            </div>
          )}
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <div className="settings-actions">
        <button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await requestHost(
                t.provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : t.baseUrl,
              );
              await send({ type: 'SAVE_SETTINGS', settings: s });
              setMessage('설정이 저장되었습니다.');
            })
          }
        >
          설정 저장
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await send({ type: 'CLEAR_CACHE' });
              setMessage('다운로드·번역 캐시를 비웠습니다.');
            })
          }
        >
          자막 캐시 비우기
        </button>
      </div>
      <p className="muted">
        API Key는 이 확장프로그램의 로컬 저장소에 보관됩니다. 웹페이지·Content Script에는 전달하지
        않습니다.
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<SettingsPage />);
