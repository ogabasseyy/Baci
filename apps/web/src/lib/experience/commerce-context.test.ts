import { expect, it, vi } from 'vitest';
import { createExperienceCheckout } from './commerce-context';

it('waits and refreshes the existing cart, then presents trusted checkout without submitting', async () => {
  const trace: string[] = [];
  const present = vi.fn();
  const checkout = createExperienceCheckout({
    settle: async () => {
      trace.push('settled');
      return true;
    },
    refresh: async () => {
      trace.push('refreshed');
    },
    prepare: async () => ({ ok: true, review: { unavailableCount: 0 } }),
    admit: () => true,
    present,
  });
  expect(await checkout.prepare()).toEqual({
    status: 'ok',
    value: { ready: true },
  });
  expect(await checkout.open()).toEqual({
    status: 'ok',
    value: { presented: true },
  });
  expect(trace).toEqual(['settled', 'refreshed', 'settled', 'refreshed']);
  expect(present).toHaveBeenCalledOnce();
});
it('does not present checkout when authority changes during refresh', async () => {
  let active = true;
  const present = vi.fn();
  const checkout = createExperienceCheckout({
    settle: async () => true,
    refresh: async () => {
      active = false;
    },
    prepare: vi.fn(),
    admit: () => active,
    present,
  });
  expect(await checkout.open()).toMatchObject({ status: 'error' });
  expect(present).not.toHaveBeenCalled();
});
it('waits for the native queue to settle and refuses a shopper change while pending', async () => {
  vi.useFakeTimers();
  try {
    const { waitForExperienceCart } = await import('./commerce-context');
    let status = 'pending';
    let allowed = true;
    const waiting = waitForExperienceCart(
      () => status,
      () => allowed
    );
    status = 'synced';
    await vi.advanceTimersByTimeAsync(50);
    expect(await waiting).toBe(true);
    status = 'pending';
    const switched = waitForExperienceCart(
      () => status,
      () => allowed
    );
    allowed = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(await switched).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
