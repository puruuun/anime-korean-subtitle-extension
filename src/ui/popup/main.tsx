import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnimeContext } from '../../anime/AnimeContext';
import type { JobStatus } from '../../background/messageRouter';
import type { Mode } from '../../subtitle/SubtitleCore';
import type { TranslationBufferStatus } from '../../translation/TranslationQueue';
import { send, originPattern } from '../api';
import '../style.css';
const modes: { id: Mode; name: string; detail: string }[] = [
  { id: 'ko', name: '한국어 자막 검색', detail: '외부 한국어 자막을 그대로 적용' },
  { id: 'ja', name: '일본어 자막 검색 → 한국어 번역', detail: '외부 일본어 자막을 AI로 번역' },
  { id: 'en', name: '사이트 영어 자막 → 한국어 번역', detail: '플레이어의 영어 자막을 AI로 번역' },
];
function clockTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = String(total % 60).padStart(2, '0');
  return hours
    ? hours + ':' + String(minutes).padStart(2, '0') + ':' + remaining
    : String(minutes).padStart(2, '0') + ':' + remaining;
}
function bufferTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(total / 60) + 'm ' + (total % 60) + 's';
}
function TranslationStatus({
  translation,
  busy,
}: {
  translation: TranslationBufferStatus;
  busy: boolean;
}) {
  const pendingChunks = translation.chunks.filter((chunk) => chunk.state === 'pending').length;
  const activeChunks = translation.chunks.filter((chunk) => chunk.state === 'translating').length;
  const state = busy
    ? '번역 중'
    : translation.failedChunks > 0
      ? '일부 번역 실패'
      : translation.completedChunks === translation.totalChunks
        ? '번역 완료'
        : '번역 중단';
  return (
    <div className="translation-buffer" aria-label="번역 Buffer 상태">
      <p className="translation-state">번역 상태: {state}</p>
      <dl className="translation-metrics">
        <div>
          <dt>현재 재생</dt>
          <dd>{clockTime(translation.playbackTime)}</dd>
        </div>
        <div>
          <dt>번역 완료</dt>
          <dd>{clockTime(translation.translatedUntil)}</dd>
        </div>
        <div>
          <dt>Buffer</dt>
          <dd>{bufferTime(translation.bufferSeconds)}</dd>
        </div>
        <div>
          <dt>목표 Buffer</dt>
          <dd>{bufferTime(translation.targetBufferSeconds)}</dd>
        </div>
      </dl>
      <small>
        Chunk {translation.completedChunks}/{translation.totalChunks} 완료 · 대기 {pendingChunks} ·
        진행 {activeChunks}
      </small>
      <small>번역 완료 시각은 현재 위치부터 연속으로 준비된 구간입니다.</small>
      {translation.failedChunks > 0 && (
        <small className="error">
          {translation.failedChunks}개 Chunk 번역 실패 · 완료된 자막은 계속 표시됩니다. 다시
          적용하면 실패한 구간을 다시 번역합니다.
        </small>
      )}
    </div>
  );
}
function Popup() {
  const [tabId, setTabId] = useState<number>();
  const [context, setContext] = useState<AnimeContext>();
  const [mode, setMode] = useState<Mode>('auto');
  const [status, setStatus] = useState<JobStatus>();
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState('');
  const [episode, setEpisode] = useState('');
  const [season, setSeason] = useState('');
  const [origins, setOrigins] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [offset, setOffset] = useState(0);
  function acceptContext(c: AnimeContext) {
    setContext(c);
    setTitle(c.title);
    setEpisode(String(c.episode));
    setSeason(c.season ? String(c.season) : '');
  }
  async function refresh(id: number) {
    const r = await send<{ status?: JobStatus }>({ type: 'GET_STATUS', tabId: id });
    setStatus(r.status);
    if (r.status) {
      setOffset(r.status.offset ?? 0);
      if (r.status.context) setContext(r.status.context);
    }
  }
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!t.id) throw Error('활성 탭이 없습니다.');
        setTabId(t.id);
        const preferences = await send<{ mode: Mode }>({ type: 'GET_PREFERENCES' });
        setMode(preferences.mode);
        const contextResult = await chrome.tabs
          .sendMessage(t.id, { type: 'CONTEXT' }, { frameId: 0 })
          .catch(() => null);
        if (contextResult?.ok) acceptContext(contextResult.context);
        else {
          setEdit(true);
          setContext({
            site: (t.url ?? '').includes('reanime.to') ? 'reanime' : 'miruro',
            title: '',
            episode: 0,
            pageUrl: t.url ?? '',
          });
          setError(
            contextResult?.error ?? 'Miruro 또는 Re:ANIME 영상 페이지를 열고 새로고침하세요.',
          );
        }
        await refresh(t.id);
        const frames = await send<{ frames: { url: string; frameId: number }[] }>({
          type: 'FRAME_INVENTORY',
          tabId: t.id,
        });
        setOrigins([
          ...new Set(
            frames.frames
              .filter((f) => f.frameId !== 0)
              .map((f) => {
                try {
                  return originPattern(f.url);
                } catch {
                  return undefined;
                }
              })
              .filter((x): x is string => !!x),
          ),
        ]);
        const subtitleOrigins = await send<{ origins: string[] }>({
          type: 'SOURCE_ORIGINS',
          tabId: t.id,
        }).catch(() => ({ origins: [] }));
        setOrigins((existing) => [...new Set([...existing, ...subtitleOrigins.origins])]);
        timer = setInterval(() => {
          if (!stopped) void refresh(t.id!).catch(() => {});
        }, 1000);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, []);
  async function run(selectedId?: string) {
    if (tabId === undefined || !context) return;
    setError('');
    setWorking(true);
    setStatus((previous) =>
      previous
        ? { ...previous, busy: true, stage: 'context', message: '작품 정보 인식 중...' }
        : undefined,
    );
    try {
      const edited = edit
        ? {
            ...context,
            title: title.trim(),
            episode: Number(episode),
            season: season ? Number(season) : undefined,
            titles: title.trim() !== context.title ? undefined : context.titles,
            ...(title.trim() !== context.title
              ? {
                  anilistId: undefined,
                  malId: undefined,
                  imdbId: undefined,
                  tmdbId: undefined,
                  englishTitle: undefined,
                  romajiTitle: undefined,
                  nativeTitle: undefined,
                  koreanTitle: undefined,
                  synonyms: undefined,
                  episodeOffset: undefined,
                  year: undefined,
                }
              : {}),
          }
        : undefined;
      const r = await send<{ status: JobStatus }>({
        type: 'RUN',
        tabId,
        mode,
        context: edited,
        selectedId,
      });
      setStatus(r.status);
      if (edited) acceptContext(edited);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function adjust(value: number) {
    if (tabId === undefined) return;
    try {
      const r = await send<{ offset: number }>({ type: 'OFFSET', tabId, offset: value });
      setOffset(r.offset);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const busy = working || !!status?.busy;
  return (
    <main className="popup">
      <div className="row">
        <p className="eyebrow">ANIME / SUBTITLE</p>
        <button
          className="icon"
          onClick={() => chrome.runtime.openOptionsPage()}
          aria-label="설정 열기"
        >
          ⚙ 설정
        </button>
      </div>
      <h1>한국어로 이어지는 이야기</h1>
      <section className="anime">
        <div className="row">
          <span className="badge">{context?.site === 'reanime' ? 'Re:ANIME' : 'Miruro'}</span>
          <button
            className="text-button"
            onClick={() => {
              if (!edit && context) {
                setTitle(context.title);
                setEpisode(String(context.episode));
                setSeason(context.season ? String(context.season) : '');
              }
              setEdit(!edit);
            }}
          >
            {edit ? '정보 접기' : '정보 수정'}
          </button>
        </div>
        {edit ? (
          <>
            <label>
              작품명
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="row">
              <label>
                시즌 (선택)
                <input
                  type="number"
                  min="1"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                />
              </label>
              <label>
                회차
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={episode}
                  onChange={(e) => setEpisode(e.target.value)}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <h2>{context?.title || '작품 정보 인식 중...'}</h2>
            <p>
              Episode {context?.episode || '—'}
              {context?.season ? ' · Season ' + context.season : ''}
            </p>
          </>
        )}
      </section>
      <p className="label-heading">한국어 자막</p>
      <div className="row">
        {(
          [
            { id: 'auto', name: '자동' },
            { id: 'manual', name: '수동' },
          ] as const
        ).map((option) => (
          <label className="mode" key={option.id}>
            <input
              name="selection"
              type="radio"
              disabled={busy}
              checked={option.id === 'auto' ? mode === 'auto' : mode !== 'auto'}
              onChange={() => {
                const next = option.id === 'auto' ? 'auto' : 'ko';
                setMode(next);
                void send({ type: 'SET_MODE', mode: next }).catch((e) => setError(e.message));
              }}
            />
            <strong>{option.name}</strong>
          </label>
        ))}
      </div>
      {mode !== 'auto' &&
        modes.map((m) => (
          <label className="mode" key={m.id}>
            <input
              name="mode"
              type="radio"
              checked={mode === m.id}
              disabled={busy}
              onChange={() => {
                setMode(m.id);
                void send({ type: 'SET_MODE', mode: m.id }).catch((e) => setError(e.message));
              }}
            />
            <span>
              <strong>{m.name}</strong>
              <small>{m.detail}</small>
            </span>
          </label>
        ))}
      <button className="primary full" disabled={busy || !context} onClick={() => void run()}>
        한국어 자막 적용
      </button>
      <div
        className={'status ' + (status?.stage === 'error' ? 'error' : '')}
        role="status"
        aria-live="polite"
      >
        <span className="status-dot" />
        {status?.message ||
          '자막: ' +
            (mode === 'auto' ? '자동 · 회차를 열면 준비합니다.' : '수동 · 자막을 적용하세요.')}
        {status?.path && <small>현재 경로 · {status.path}</small>}
        {status?.progress && <progress value={status.progress.done} max={status.progress.total} />}
        {status?.translation && (
          <TranslationStatus translation={status.translation} busy={!!status.busy} />
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status?.stage === 'select' &&
        status.results?.map((r) => (
          <div className="result subtitle-candidate" key={r.id}>
            <strong>{r.release || r.title}</strong>
            <br />
            {r.providerId} · {r.language.toUpperCase()} ·{' '}
            {r.episode === undefined ? '회차 미확인' : 'EP ' + r.episode} · Score {r.score}
            <br />
            <small>{r.reasons?.join(' · ')}</small>
            {r.updatedAt && (
              <small className="candidate-updated">업데이트 {r.updatedAt.replace('T', ' ')}</small>
            )}
            {r.listedEpisode && r.listedEpisode !== String(r.episode) && (
              <small>
                제작자 최신 등록 회차 · {r.listedEpisode} (파일 회차를 별도로 확인합니다)
              </small>
            )}
            {r.linkMessage && <p>{r.linkMessage}</p>}
            <div className="candidate-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    try {
                      if (r.requiredOrigins?.length) {
                        const allowed = await chrome.permissions.request({
                          origins: r.requiredOrigins,
                        });
                        if (!allowed)
                          throw Error(
                            '자막 도메인의 접근 권한이 허용되지 않았습니다. 배포 페이지에서 확인하세요.',
                          );
                      }
                      await run(r.id);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  })();
                }}
              >
                {r.requiredOrigins?.length ? '접근 허용 후 적용' : '이 자막 적용'}
              </button>
              {r.pageUrl && (
                <a href={r.pageUrl} target="_blank" rel="noreferrer">
                  배포 페이지 열기 ↗
                </a>
              )}
            </div>
          </div>
        ))}
      <section className="sync">
        <div className="row">
          <strong>자막 싱크</strong>
          <span className="muted">
            {offset > 0 ? '+' : ''}
            {offset.toFixed(1)}s
          </span>
        </div>
        <div className="toolbar">
          <button
            className="secondary"
            onClick={() => void adjust(offset - 0.5)}
            disabled={!status}
          >
            −0.5s
          </button>
          <button className="secondary" onClick={() => void adjust(0)} disabled={!status}>
            Reset
          </button>
          <button
            className="secondary"
            onClick={() => void adjust(offset + 0.5)}
            disabled={!status}
          >
            +0.5s
          </button>
        </div>
        <small>양수 값은 자막을 앞당깁니다. 회차별로 저장됩니다.</small>
      </section>
      {origins.length > 0 && (
        <button
          className="secondary full"
          onClick={() => {
            void (async () => {
              try {
                const allowed = await chrome.permissions.request({ origins });
                if (!allowed) throw Error('iframe 접근 권한이 허용되지 않았습니다.');
                await send({ type: 'INJECT_FRAMES', tabId });
                setError('플레이어를 새로고침하면 초기 자막 API도 탐지됩니다.');
              } catch (e) {
                setError((e as Error).message);
              }
            })();
          }}
        >
          플레이어·자막 접근 허용
        </button>
      )}
      <div className="toolbar">
        <button
          className="text-button"
          onClick={() => {
            void send({ type: 'CANCEL', tabId }).then(
              () => {
                setStatus(undefined);
              },
              (e) => setError(e.message),
            );
          }}
        >
          자막 끄기 / 취소
        </button>
        <button
          className="text-button"
          onClick={() => {
            void chrome.tabs
              .sendMessage(tabId!, { type: 'DEMO' })
              .catch((e) => setError(e.message));
          }}
        >
          렌더러 테스트
        </button>
      </div>
      <p className="muted footer">텍스트 자막만 처리 · 다음 회차 자동 적용</p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
