export const AUTO_RETRY_WINDOW_MS = 120000;
export const AUTO_RETRY_DELAYS_MS = [3000, 6000, 12000, 20000, 20000] as const;
export const PLAYER_CHECK_MS = 1000;
export interface AutoEpisode {
  key: string;
  context: import('../anime/AnimeContext').AnimeContext;
  startedAt: number;
  deadlineAt: number;
  attempt: number;
  nextAt?: number;
  waiting?: boolean;
  stopped?: boolean;
}
export function nextRetry(state: AutoEpisode, now = Date.now()): number | undefined {
  const delay = AUTO_RETRY_DELAYS_MS[state.attempt - 1];
  return delay !== undefined && now + delay < state.deadlineAt ? delay : undefined;
}
