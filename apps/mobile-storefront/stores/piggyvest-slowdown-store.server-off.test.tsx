import {
  nextSlowSignalExpiry,
  PIGGYVEST_SLOW_SIGNAL_TTL_MS,
  usePiggyvestSlowdownStore,
} from './piggyvest-slowdown-store';

beforeEach(() => usePiggyvestSlowdownStore.setState({ signals: {} }));

describe('piggyvest slowdown store with PiggyVest off', () => {
  it('starts with no slowdown', () => {
    expect(
      nextSlowSignalExpiry(usePiggyvestSlowdownStore.getState().signals, 0)
    ).toBeNull();
  });

  it('remembers a slow signal for its TTL, then forgets it', () => {
    usePiggyvestSlowdownStore.getState().markSlow('wallet-read', 1000);
    const { signals } = usePiggyvestSlowdownStore.getState();
    expect(nextSlowSignalExpiry(signals, 1000)).toBe(
      1000 + PIGGYVEST_SLOW_SIGNAL_TTL_MS
    );
    expect(
      nextSlowSignalExpiry(signals, 1000 + PIGGYVEST_SLOW_SIGNAL_TTL_MS)
    ).toBeNull();
  });

  it('clears one source without touching another', () => {
    const store = usePiggyvestSlowdownStore.getState();
    store.markSlow('wallet-read', 0);
    store.markSlow('goal-setup', 10);
    usePiggyvestSlowdownStore.getState().clearSlow('wallet-read');
    expect(usePiggyvestSlowdownStore.getState().signals).toEqual({
      'goal-setup': 10 + PIGGYVEST_SLOW_SIGNAL_TTL_MS,
    });
  });
});
