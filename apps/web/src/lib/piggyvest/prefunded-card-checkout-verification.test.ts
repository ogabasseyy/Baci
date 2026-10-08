import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefundedCardCheckoutRuntime } from './prefunded-card-checkout-runtime';
import { prefundedCardCheckoutRuntimeFixture } from './prefunded-card-checkout-runtime.test-fixture';

vi.mock('server-only', () => ({}));

const { fixture, reserved, ready, promoted } =
  prefundedCardCheckoutRuntimeFixture();
let timestamp: number;

function setup() {
  return prefundedCardCheckoutRuntimeFixture(() => timestamp);
}

beforeEach(() => {
  timestamp = Date.parse('2026-09-26T12:00:00Z');
});

describe('first-card checkout collection verification', () => {
  it('uses independent verification and promotes the same already-collected intent', async () => {
    const { store, provider, runtime } = setup();
    const result = await runtime.refresh(fixture.customerSelection);
    expect(provider.verify).toHaveBeenCalledWith(fixture.intent);
    expect(store.promoteVerifiedCollection).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection,
      fixture.collection
    );
    expect(result.status).toBe('funding_pending');
    expect(provider.initialize).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/AUTH_|CUS_|SIG_/);
    store.read.mockResolvedValue(promoted);
    await runtime.refresh(fixture.customerSelection);
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expect(store.promoteVerifiedCollection).toHaveBeenCalledTimes(1);
  });

  it('does not call collection complete merely from a callback or an unrelated receipt', async () => {
    const { store, provider, runtime } = setup();
    await expect(
      runtime.refresh({ ...fixture.customerSelection, paid: true })
    ).rejects.toThrow('First-card checkout unavailable');
    expect(provider.verify).not.toHaveBeenCalled();
    provider.verify.mockResolvedValueOnce({
      outcome: 'verified',
      collection: { ...fixture.collection, amountKobo: 20000 },
    });
    await expect(runtime.refresh(fixture.customerSelection)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(store.promoteVerifiedCollection).not.toHaveBeenCalled();
  });

  it('retains uncertain verification and records review without admitting another charge', async () => {
    const { store, provider, runtime } = setup();
    provider.verify.mockRejectedValueOnce(new Error('private-provider-body'));
    expect((await runtime.refresh(fixture.customerSelection)).status).toBe(
      'pending'
    );
    provider.verify.mockResolvedValueOnce({
      outcome: 'reconciliation_required',
    });
    expect((await runtime.refresh(fixture.customerSelection)).status).toBe(
      'reconciliation_required'
    );
    expect(store.flagReconciliation).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection
    );
    expect(store.promoteVerifiedCollection).not.toHaveBeenCalled();
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('does not report payment as savings completion until storage reports canonical completion', async () => {
    const { store, runtime } = setup();
    store.promoteVerifiedCollection.mockResolvedValueOnce(ready);
    await expect(runtime.refresh(fixture.customerSelection)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    store.promoteVerifiedCollection.mockResolvedValueOnce({
      ...promoted,
      phase: 'completed',
    });
    expect((await runtime.refresh(fixture.customerSelection)).status).toBe(
      'completed'
    );
  });

  it('returns review instead of payment success when a concurrently saved card conflicts with promotion', async () => {
    const { store, provider, runtime } = setup();
    store.promoteVerifiedCollection.mockResolvedValueOnce({
      ...reserved,
      phase: 'reconciliation_required',
    });
    const result = await runtime.refresh(fixture.customerSelection);
    expect(result.status).toBe('reconciliation_required');
    expect(result).not.toHaveProperty('authorizationUrl');
    expect(store.promoteVerifiedCollection).toHaveBeenCalledTimes(1);
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('validates persisted status ownership and prevents new writes at expiry', async () => {
    const { store, provider, runtime } = setup();
    store.read.mockResolvedValueOnce({
      ...ready,
      intent: { ...fixture.intent, actorId: fixture.intent.customerId },
    });
    await expect(runtime.refresh(fixture.customerSelection)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(provider.verify).not.toHaveBeenCalled();
    timestamp = Date.parse(fixture.scope.expiresAt);
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(store.reserve).not.toHaveBeenCalled();
    expect(() =>
      createPrefundedCardCheckoutRuntime({
        scope: fixture.scope,
        store,
        provider,
        resolveCustomer: vi.fn().mockResolvedValue(fixture.customerIdentity),
        now: () => Number.NaN,
      })
    ).toThrow('First-card checkout unavailable');
  });
});
