import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnimeContext } from '../../anime/AnimeContext';
import type { JobStatus } from '../../background/messageRouter';
import type { Mode } from '../../subtitle/SubtitleCore';
import type { TranslationBufferStatus } from '../../translation/TranslationQueue';
import { send } from '../api';
import { workElapsedSeconds, workPending } from '../../background/jobClock';
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
          {translation.failedChunks}개 Chunk 번역 실패 · 완료된 자막은 계속 표시됩니다. 번역을
          재시작하면 실패한 구간을 다시 번역합니다.
        </small>
      )}
    </div>
  );
}
function stageLabel(stage: string | undefined, mode: Mode) {
  return (
    (
      {
        context: '작품 정보 확인 중',
        search: '자막 찾는 중',
        download: '다운로드·해석 중',
        source: '자막 적용 중',
        extract: '영어 자막 읽는 중',
        translate: '한국어 번역 중',
        retry: '자동 재시도 대기',
        'waiting-player': '플레이어 준비 대기',
        done: '한국어 자막 준비 완료',
        partial: '일부 번역 미완료',
        error: '작업 확인 필요',
        select: '수동 후보 확인',
        manual: '수동 모드',
        interrupted: '작업 복구 필요',
      } as Record<string, string>
    )[stage ?? ''] ?? (mode === 'auto' ? '회차 자동 감지 대기' : '수동 모드')
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
  const [missingOrigins, setMissingOrigins] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [offset, setOffset] = useState(0);
  const [showJapanese, setShowJapanese] = useState(false);
  const [changingJapanese, setChangingJapanese] = useState(false);
  const japanesePending = useRef(false);
  const japaneseRevision = useRef(0);
  function acceptContext(c: AnimeContext) {
    setContext(c);
    setTitle(c.title);
    setEpisode(String(c.episode));
    setSeason(c.season ? String(c.season) : '');
  }
  async function refresh(id: number) {
    const r = await send<{ status?: JobStatus }>({ type: 'GET_STATUS', tabId: id });
    setStatus(r.status);
    const revision = japaneseRevision.current;
    const preferences = await send<{ mode: Mode; showJapanese: boolean }>({
      type: 'GET_PREFERENCES',
    });
    setMode(preferences.mode);
    if (!japanesePending.current && revision === japaneseRevision.current)
      setShowJapanese(preferences.showJapanese);
    const access = await send<{ missing: string[] }>({ type: 'ACCESS_STATUS', tabId: id }).catch(
      () => ({ missing: [] }),
    );
    setMissingOrigins(access.missing);
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
          setEdit(preferences.mode !== 'auto');
          setContext({
            site: (t.url ?? '').includes('reanime.to') ? 'reanime' : 'miruro',
            title: '',
            episode: 0,
            pageUrl: t.url ?? '',
          });
          setError(
            contextResult?.error ??
              '영상 페이지를 새로고침하세요. 연결되지 않으면 Chrome 확장 세부정보의 사이트 접근을 확인하세요.',
          );
        }
        await refresh(t.id);
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
        refresh: !status?.translation?.failedChunks,
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
  async function changeMode(next: Mode) {
    setMode(next);
    setError('');
    try {
      await send({ type: 'SET_MODE', mode: next });
      if (tabId !== undefined) await refresh(tabId);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const busy = working || !!status?.busy;
  async function changeJapanese(enabled: boolean) {
    const previous = showJapanese;
    japanesePending.current = true;
    japaneseRevision.current++;
    setShowJapanese(enabled);
    setChangingJapanese(true);
    setError('');
    try {
      const r = await send<{ showJapanese: boolean }>({ type: 'SET_JAPANESE', enabled });
      setShowJapanese(r.showJapanese);
      if (tabId !== undefined) await refresh(tabId);
    } catch (e) {
      setShowJapanese(previous);
      setError((e as Error).message);
    } finally {
      japanesePending.current = false;
      setChangingJapanese(false);
    }
  }
  return (
    <main className="popup">
      <section className="work-status" role="status" aria-live="polite" aria-label="현재 작업 상태">
        <div className="row work-heading">
          <strong>자막: {mode === 'auto' ? '자동' : '수동'}</strong>
          <button
            className="text-button"
            onClick={() => void changeMode(mode === 'auto' ? 'ko' : 'auto')}
          >
            {mode === 'auto' ? '수동 전환' : '자동 전환'}
          </button>
          <button
            className="icon"
            onClick={() => chrome.runtime.openOptionsPage()}
            aria-label="설정 열기"
          >
            설정
          </button>
        </div>
        <p className="current-episode">
          {context?.title || '영상 페이지를 기다리고 있습니다.'}
          {context?.episode ? ' · EP ' + context.episode : ''}
        </p>
        <p
          className={
            'work-stage ' +
            (status?.stage === 'error' || error || missingOrigins.length ? 'error' : '')
          }
        >
          <span className="status-dot" />
          {status?.stage === 'done' && status.japanese?.state === 'searching'
            ? '한국어 적용 완료 · 일본어 찾는 중'
            : stageLabel(status?.stage, mode)}
        </p>
        <p className="work-message">
          {error ||
            (missingOrigins.length
              ? '사이트 접근이 차단되었습니다. Chrome 확장 세부정보에서 사이트 접근을 허용한 뒤 새로고침하세요.'
              : status?.message) ||
            (mode === 'auto'
              ? '회차를 선택하면 자막을 자동으로 준비합니다.'
              : '사용할 자막 경로를 선택하세요.')}
        </p>
        {status?.path && (
          <small className="work-source">
            Source: {status.path}
            {status.cached ? ' · 캐시' : ''}
          </small>
        )}
        {status?.retry?.nextAt && (
          <small className="retry-countdown">
            {Math.max(0, Math.ceil((status.retry.nextAt - Date.now()) / 1000))}초 후 재시도 · 시도{' '}
            {status.retry.attempt}/{status.retry.maxAttempts}
          </small>
        )}
        {status?.retry?.reason && <small className="retry-reason">{status.retry.reason}</small>}
        {status?.warnings?.map((warning, i) => (
          <small className="error" key={i}>
            {warning}
          </small>
        ))}
        {missingOrigins.length > 0 && (
          <button
            className="text-button"
            onClick={() =>
              chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id })
            }
          >
            Chrome 권한 설정 열기
          </button>
        )}
        {status?.progress && <progress value={status.progress.done} max={status.progress.total} />}
        {showJapanese && (
          <small className="japanese-status" data-state={status?.japanese?.state ?? 'off'}>
            추가 자막:{' '}
            {status?.japanese?.state === 'off' || !status?.japanese
              ? '일본어 원문 준비 대기'
              : status.japanese.message}
            {status?.japanese?.source ? ' · ' + status.japanese.source : ''}
          </small>
        )}
        {status?.translation ? (
          <TranslationStatus translation={status.translation} busy={!!status.busy} />
        ) : (
          <dl className="work-metrics">
            <div>
              <dt>현재 재생</dt>
              <dd>{clockTime(status?.playbackTime ?? 0)}</dd>
            </div>
            <div>
              <dt>작업 경과</dt>
              <dd data-work-elapsed="true">
                {clockTime(workElapsedSeconds(status))}
                {status?.startedAt && !workPending(status) ? ' · 종료' : ''}
              </dd>
            </div>
          </dl>
        )}
        {status?.translation && (
          <dl className="work-metrics">
            <div>
              <dt>작업 경과</dt>
              <dd data-work-elapsed="true">
                {clockTime(workElapsedSeconds(status))}
                {!workPending(status) ? ' · 종료' : ''}
              </dd>
            </div>
          </dl>
        )}
      </section>
      <div className="popup-body">
        <section className="additional-subtitle">
          <label className="check">
            <input
              type="checkbox"
              checked={showJapanese}
              disabled={changingJapanese}
              onChange={(e) => void changeJapanese(e.target.checked)}
            />
            일본어 원문 함께 보기
          </label>
          <p className="muted">
            한국어 아래에 일본어 추가 자막을 표시합니다. 글자 크기와 일본어 싱크는 설정에서
            조절하세요.
          </p>
        </section>
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
                checked={option.id === 'auto' ? mode === 'auto' : mode !== 'auto'}
                onChange={() => {
                  const next = option.id === 'auto' ? 'auto' : 'ko';
                  void changeMode(next);
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
                  void changeMode(m.id);
                }}
              />
              <span>
                <strong>{m.name}</strong>
                <small>{m.detail}</small>
              </span>
            </label>
          ))}
        <button
          className="secondary full"
          disabled={busy || !context?.title || !context?.episode}
          onClick={() => void run()}
        >
          {mode !== 'auto'
            ? '수동 자막 실행'
            : status?.translation?.failedChunks
              ? '번역 재시작'
              : '다시 검색'}
        </button>
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
                <small className="candidate-updated">
                  업데이트 {r.updatedAt.replace('T', ' ')}
                </small>
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
                        await run(r.id);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    })();
                  }}
                >
                  이 자막 다시 확인
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
        <p className="muted footer">다음 회차 자동 감지 · 실패 재시도 최대 2분</p>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
