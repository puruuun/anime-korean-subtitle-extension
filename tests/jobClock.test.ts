import { describe, expect, it } from 'vitest';
import { settleWorkClock, workElapsedSeconds, type WorkClock } from '../src/background/jobClock';
const running = (): WorkClock => ({
  startedAt: 1000,
  updatedAt: 1000,
  busy: true,
  stage: 'search',
  workElapsedMs: 0,
  workActiveSince: 1000,
});
describe('work time follows actual pending work', () => {
  it('freezes a completed job even when playback updates its status', () => {
    const done = settleWorkClock({ ...running(), busy: false, stage: 'done' }, 4500);
    expect(done.finishedAt).toBe(4500);
    expect(workElapsedSeconds(done, 90000)).toBe(3.5);
    const playback = settleWorkClock({ ...done, updatedAt: 100000 }, 100000);
    expect(playback.finishedAt).toBe(4500);
    expect(workElapsedSeconds(playback, 200000)).toBe(3.5);
  });
  it('keeps counting when Korean is done but Japanese acquisition is pending', () => {
    const pending = settleWorkClock(
      { ...running(), busy: false, stage: 'done', japanese: { state: 'searching' } },
      4500,
    );
    expect(pending.finishedAt).toBeUndefined();
    expect(workElapsedSeconds(pending, 7000)).toBe(6);
    const done = settleWorkClock({ ...pending, japanese: { state: 'unavailable' } }, 8000);
    expect(workElapsedSeconds(done, 90000)).toBe(7);
  });
  it('resumes later extra subtitle work without counting the idle interval', () => {
    const done = settleWorkClock({ ...running(), busy: false, stage: 'done' }, 4000);
    const extra = settleWorkClock({ ...done, japanese: { state: 'searching' } }, 20000);
    expect(workElapsedSeconds(extra, 22000)).toBe(5);
    const stopped = settleWorkClock({ ...extra, japanese: { state: 'off' } }, 23000);
    expect(workElapsedSeconds(stopped, 90000)).toBe(6);
  });
  it.each(['error', 'partial', 'select', 'manual', 'interrupted'])(
    'stops when %s has no remaining task',
    (stage) => {
      const status = settleWorkClock({ ...running(), stage, busy: false }, 5000);
      expect(workElapsedSeconds(status, 90000)).toBe(4);
    },
  );
  it('counts player waiting and scheduled retries even while busy is false', () => {
    for (const status of [
      { stage: 'waiting-player' },
      { stage: 'retry', retry: { nextAt: 10000 } },
    ]) {
      const next = settleWorkClock({ ...running(), ...status, busy: false }, 3000);
      expect(workElapsedSeconds(next, 8000)).toBe(7);
    }
  });
  it('uses the last saved terminal time for a legacy status without clock fields', () => {
    const legacy = { startedAt: 1000, updatedAt: 7000, stage: 'done', busy: false };
    expect(workElapsedSeconds(legacy, 90000)).toBe(6);
  });
});
