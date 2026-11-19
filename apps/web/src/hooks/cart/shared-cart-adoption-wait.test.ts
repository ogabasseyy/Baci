import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveUnsettledCartAdoption } from './shared-cart-adoption-wait';

afterEach(() => vi.useRealTimers());

describe('resolveUnsettledCartAdoption', () => {
  it('reruns immediately when adoption already settled', async () => {
    const rerun = vi.fn(async () => ({ ok: true }) as const);
    await expect(
      resolveUnsettledCartAdoption({ current: 'session' }, () => true, rerun)
    ).resolves.toEqual({ ok: true });
    expect(rerun).toHaveBeenCalledOnce();
  });

  it('waits for the outcome to change, then reruns', async () => {
    vi.useFakeTimers();
    const ref = { current: 'unknown' };
    const rerun = vi.fn(async () => ({ ok: true }) as const);
    const pending = resolveUnsettledCartAdoption(ref, () => true, rerun);
    await vi.advanceTimersByTimeAsync(100);
    expect(rerun).not.toHaveBeenCalled();
    ref.current = 'session';
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('returns the retryable failure after the bounded wait', async () => {
    vi.useFakeTimers();
    const rerun = vi.fn();
    const pending = resolveUnsettledCartAdoption(
      { current: 'unknown' },
      () => true,
      rerun,
      200
    );
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });
    expect(rerun).not.toHaveBeenCalled();
  });

  it('answers null without rerunning when the fence closes', async () => {
    vi.useFakeTimers();
    let live = true;
    const rerun = vi.fn();
    const pending = resolveUnsettledCartAdoption(
      { current: 'unknown' },
      () => live,
      rerun
    );
    live = false;
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeNull();
    expect(rerun).not.toHaveBeenCalled();
  });
});
