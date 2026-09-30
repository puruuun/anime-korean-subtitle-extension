import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSettings, type Settings } from '../../storage/settings';
import { send, requestHost } from '../api';
import '../style.css';
function SettingsPage() {
  const [s, setS] = useState<Settings>(structuredClone(defaultSettings));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
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
  function subdl<K extends keyof Settings['providers']['subdl']>(
    key: K,
    value: Settings['providers']['subdl'][K],
  ) {
    setS({ ...s, providers: { ...s.providers, subdl: { ...s.providers.subdl, [key]: value } } });
  }
  function opensubtitles<K extends keyof Settings['providers']['opensubtitles']>(
    key: K,
    value: Settings['providers']['opensubtitles'][K],
  ) {
    setS({
      ...s,
      providers: { ...s.providers, opensubtitles: { ...s.providers.opensubtitles, [key]: value } },
    });
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
      <p className="eyebrow">ANIME / SUBTITLE / SETTINGS</p>
      <h1>편안한 감상을 위한 설정</h1>
      <p>번역 서버와 자막 검색 서비스를 연결하세요.</p>
      <section>
        <div className="section-title">
          <span className="number">01</span>
          <h2>번역 서버</h2>
        </div>
        <div className="grid">
          <label>
            Provider
            <select
              value={t.provider}
              onChange={(e) => translation('provider', e.target.value as 'lmstudio' | 'openai')}
            >
              <option value="lmstudio">LM Studio</option>
              <option value="openai">OpenAI-compatible API</option>
            </select>
          </label>
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
        </div>
        <label>
          Base URL
          <input
            type="url"
            value={t.baseUrl}
            placeholder="http://127.0.0.1:1234/v1"
            onChange={(e) => translation('baseUrl', e.target.value)}
          />
        </label>
        <div className="grid">
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={t.apiKey}
              onChange={(e) => translation('apiKey', e.target.value)}
            />
          </label>
          <label>
            Model ID
            <input
              value={t.model}
              list="models"
              onChange={(e) => translation('model', e.target.value)}
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
              await requestHost(t.baseUrl);
              const r = await send<{ models: string[] }>({ type: 'TEST_CONNECTION', settings: s });
              setModels(r.models);
              setMessage('연결 성공 · ' + r.models.length + '개 모델');
            })
          }
        >
          Test Connection
        </button>
        <p className="muted">
          서버의 /v1 경로를 포함하세요. JSON Schema를 지원하지 않는 모델은 출력 형식을 변경하세요.
        </p>
      </section>
      <section>
        <div className="section-title">
          <span className="number">02</span>
          <h2>자막 Provider</h2>
        </div>
        <div className="grid">
          <div className="provider">
            <h3>SubDL</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={s.providers.subdl.enabled}
                onChange={(e) => subdl('enabled', e.target.checked)}
              />{' '}
              사용
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                value={s.providers.subdl.apiKey}
                onChange={(e) => subdl('apiKey', e.target.value)}
              />
            </label>
            <label>
              우선순위
              <input
                type="number"
                min="1"
                value={s.providers.subdl.priority}
                onChange={(e) => subdl('priority', Number(e.target.value))}
              />
            </label>
            <a href="https://subdl.com/api-doc" target="_blank" rel="noreferrer">
              API Key 안내 ↗
            </a>
          </div>
          <div className="provider">
            <h3>OpenSubtitles</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={s.providers.opensubtitles.enabled}
                onChange={(e) => opensubtitles('enabled', e.target.checked)}
              />{' '}
              사용
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                value={s.providers.opensubtitles.apiKey}
                onChange={(e) => opensubtitles('apiKey', e.target.value)}
              />
            </label>
            <label>
              Token
              <input
                type="password"
                autoComplete="off"
                value={s.providers.opensubtitles.token}
                onChange={(e) => opensubtitles('token', e.target.value)}
              />
            </label>
            <div className="grid">
              <label>
                Username
                <input
                  autoComplete="off"
                  value={s.providers.opensubtitles.username}
                  onChange={(e) => opensubtitles('username', e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="off"
                  value={s.providers.opensubtitles.password}
                  onChange={(e) => opensubtitles('password', e.target.value)}
                />
              </label>
            </div>
            <label>
              우선순위
              <input
                type="number"
                min="1"
                value={s.providers.opensubtitles.priority}
                onChange={(e) => opensubtitles('priority', Number(e.target.value))}
              />
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await send({ type: 'LOGIN_OPENSUBTITLES', config: s.providers.opensubtitles });
                  const r = await send<{ settings: Settings }>({ type: 'GET_SETTINGS' });
                  setS({
                    ...s,
                    providers: {
                      ...s.providers,
                      opensubtitles: r.settings.providers.opensubtitles,
                    },
                  });
                  setMessage('OpenSubtitles 로그인 성공 · Token 저장');
                })
              }
            >
              로그인 / Token 저장
            </button>
          </div>
        </div>
        <p className="muted">
          작은 우선순위 숫자를 먼저 사용합니다. API Key는 각 서비스에서 발급받으세요.
        </p>
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
          한국어로 이어지는 이야기
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
              await requestHost(t.baseUrl);
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
