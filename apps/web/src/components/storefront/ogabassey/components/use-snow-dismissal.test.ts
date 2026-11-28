import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


let SNOW_STOPPED_KEY: string;
let useSnowDismissal: typeof import('./use-snow-dismissal').useSnowDismissal;

describe('useSnowDismissal', () => {
  const store = new Map<string, string>();

  beforeEach(async () => {
    vi.resetModules();
    ({ SNOW_STOPPED_KEY, useSnowDismissal } = await import(
      './use-snow-dismissal'
    ));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 10));
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts running and records the current year when stopped', () => {
    const { result } = renderHook(() => useSnowDismissal());
    expect(result.current.stopped).toBe(false);

    act(() => result.current.stop());

    expect(result.current.stopped).toBe(true);
    expect(store.get(SNOW_STOPPED_KEY)).toBe('2026');
  });

  it('starts stopped when this year is already recorded', () => {
    store.set(SNOW_STOPPED_KEY, '2026');
    const { result } = renderHook(() => useSnowDismissal());
    expect(result.current.stopped).toBe(true);
  });

  it('runs again once the year rolls over', () => {
    store.set(SNOW_STOPPED_KEY, '2026');
    vi.setSystemTime(new Date(2027, 11, 1));
    const { result } = renderHook(() => useSnowDismissal());
    expect(result.current.stopped).toBe(false);
  });

  it('still stops for the visit when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    const { result } = renderHook(() => useSnowDismissal());
    expect(result.current.stopped).toBe(false);

    act(() => result.current.stop());

    expect(result.current.stopped).toBe(true);
  });

  it('stays stopped after a remount when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    const first = renderHook(() => useSnowDismissal());
    act(() => first.result.current.stop());
    first.unmount();

    const { result } = renderHook(() => useSnowDismissal());

    expect(result.current.stopped).toBe(true);
  });
});
