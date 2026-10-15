export interface WorkClock {
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  workElapsedMs?: number;
  workActiveSince?: number;
  busy: boolean;
  stage: string;
  japanese?: { state: string };
  retry?: { nextAt?: number };
}
export function workPending(s: WorkClock) {
  return (
    s.busy ||
    s.japanese?.state === 'searching' ||
    s.stage === 'waiting-player' ||
    (s.stage === 'retry' && s.retry?.nextAt !== undefined)
  );
}
export function settleWorkClock<T extends WorkClock>(s: T, now = Date.now()): T {
  const base = s.workElapsedMs ?? 0;
  const since = s.workActiveSince ?? (s.workElapsedMs === undefined ? s.startedAt : undefined);
  if (workPending(s))
    return { ...s, workElapsedMs: base, workActiveSince: since ?? now, finishedAt: undefined };
  return {
    ...s,
    workElapsedMs: base + (since === undefined ? 0 : Math.max(0, now - since)),
    workActiveSince: undefined,
    finishedAt: s.finishedAt ?? now,
  };
}
export function workElapsedSeconds(s?: WorkClock, now = Date.now()) {
  if (!s) return 0;
  if (s.workElapsedMs !== undefined)
    return (
      (s.workElapsedMs +
        (workPending(s) && s.workActiveSince !== undefined
          ? Math.max(0, now - s.workActiveSince)
          : 0)) /
      1000
    );
  return s.startedAt
    ? Math.max(0, (workPending(s) ? now : (s.finishedAt ?? s.updatedAt)) - s.startedAt) / 1000
    : 0;
}
