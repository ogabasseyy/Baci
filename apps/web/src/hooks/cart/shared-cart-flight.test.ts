import { describe, expect, it, vi } from 'vitest';
import {
  type EnsureCartFlight,
  runSingleFlightEnsureCart,
} from './shared-cart-flight';

describe('runSingleFlightEnsureCart', () => {
  it('coalesces concurrent calls matching generation and merchant', async () => {
    const flightRef: { current: EnsureCartFlight | null } = { current: null };
    let resolveFlight!: (value: { ok: true }) => void;
    const start = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveFlight = resolve;
        })
    );

    const p1 = runSingleFlightEnsureCart(
      flightRef,
      { generation: 1, merchantId: 'm1', merchantSlug: 'store' },
      start
    );
    const p2 = runSingleFlightEnsureCart(
      flightRef,
      { generation: 1, merchantId: 'm1', merchantSlug: 'store' },
      start
    );

    expect(start).toHaveBeenCalledTimes(1);
    resolveFlight({ ok: true });
    expect(await Promise.all([p1, p2])).toEqual([{ ok: true }, { ok: true }]);
    expect(flightRef.current).toBeNull();
  });

  it('starts a new flight when merchant or generation changes', async () => {
    const flightRef: { current: EnsureCartFlight | null } = { current: null };
    const start = vi.fn(async () => ({ ok: true as const }));

    await runSingleFlightEnsureCart(
      flightRef,
      { generation: 1, merchantId: 'm1', merchantSlug: 'store-a' },
      start
    );
    await runSingleFlightEnsureCart(
      flightRef,
      { generation: 2, merchantId: 'm1', merchantSlug: 'store-a' },
      start
    );

    expect(start).toHaveBeenCalledTimes(2);
    expect(flightRef.current).toBeNull();
  });
});
