import { create } from 'zustand';

/** Where a slow PiggyVest answer was seen. */
export type PiggyvestSlowSource = 'wallet-read' | 'goal-setup';

/** A slow signal counts for this long unless it is renewed or cleared. */
export const PIGGYVEST_SLOW_SIGNAL_TTL_MS = 5 * 60_000;

interface PiggyvestSlowdownState {
  /** Source -> time the signal stops counting (ms since epoch). */
  signals: Partial<Record<PiggyvestSlowSource, number>>;
  markSlow: (source: PiggyvestSlowSource, now?: number) => void;
  clearSlow: (source: PiggyvestSlowSource) => void;
}

/**
 * App-wide memory of whether PiggyVest is answering slowly right now, so the
 * wallet and savings screens can show one calm notice instead of each
 * screen's own alarming state. Signals are raised only after a screen's own
 * quick retries have failed, so a single blip never shows the notice.
 */
export const usePiggyvestSlowdownStore = create<PiggyvestSlowdownState>(
  (set) => ({
    signals: {},
    markSlow: (source, now = Date.now()) =>
      set((state) => ({
        signals: {
          ...state.signals,
          [source]: now + PIGGYVEST_SLOW_SIGNAL_TTL_MS,
        },
      })),
    clearSlow: (source) =>
      set((state) => {
        if (state.signals[source] === undefined) return state;
        const { [source]: _cleared, ...rest } = state.signals;
        return { signals: rest };
      }),
  })
);

/** The earliest time a live signal expires, or null when none is live. */
export function nextSlowSignalExpiry(
  signals: PiggyvestSlowdownState['signals'],
  now: number
): number | null {
  const live = Object.values(signals).filter(
    (expiresAt): expiresAt is number =>
      typeof expiresAt === 'number' && expiresAt > now
  );
  return live.length > 0 ? Math.min(...live) : null;
}
