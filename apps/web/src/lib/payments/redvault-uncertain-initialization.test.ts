import { describe, expect, it, vi } from 'vitest';
import { initializeRedvaultCheckout } from './redvault-payment-initialize';

const attempt = {
  amountKobo: 95000,
  authorizationUrl: null,
  bankCode: '033',
  id: 'attempt-1',
  paystackSubaccount: 'ACCT_fixture',
  platformFeeKobo: 1900,
  reference: 'RV-ref',
  splitRetainedShippingKobo: 0,
};

describe('REDVAULT uncertain provider initialization', () => {
  it.each([
    'not_found',
    'unpaid',
  ] as const)('does not replay or void an indeterminate attempt after %s', async (status) => {
    const stored = { ...attempt, state: 'indeterminate' as const };
    const adapter = {
      reserve: vi.fn().mockResolvedValue(stored),
      claimInitialization: vi.fn(),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn(),
    };
    const provider = {
      initialize: vi.fn(),
      probeInitialization: vi.fn().mockResolvedValue({ status }),
    };
    expect(
      await initializeRedvaultCheckout({
        attemptAdapter: adapter,
        provider,
        customerEmail: 'buyer@example.test',
        orderId: 'order',
        redirectUrl: 'https://example.test',
      })
    ).toEqual({ authorizationUrl: null, status: 'pending_reconciliation' });
    expect(adapter.reconcileInitialization).not.toHaveBeenCalled();
    expect(adapter.reserve).toHaveBeenCalledOnce();
    expect(provider.probeInitialization).not.toHaveBeenCalled();
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it.each([
    'not_found',
    'unpaid',
  ] as const)('does not replay or void a reclaimed initialization after %s', async (status) => {
    const stored = { ...attempt, state: 'initializing' as const };
    const adapter = {
      reserve: vi.fn().mockResolvedValue(stored),
      claimInitialization: vi
        .fn()
        .mockResolvedValue({ attempt: stored, claimed: true }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn(),
    };
    const provider = {
      initialize: vi.fn(),
      probeInitialization: vi.fn().mockResolvedValue({ status }),
    };
    expect(
      await initializeRedvaultCheckout({
        attemptAdapter: adapter,
        provider,
        customerEmail: 'buyer@example.test',
        orderId: 'order',
        redirectUrl: 'https://example.test',
      })
    ).toEqual({ authorizationUrl: null, status: 'pending_reconciliation' });
    expect(adapter.reconcileInitialization).not.toHaveBeenCalledWith(
      'attempt-1',
      'void'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('does not dispatch when a stale created snapshot receives a reclaimed claim', async () => {
    const created = { ...attempt, state: 'created' as const };
    const reclaimed = { ...attempt, state: 'initializing' as const };
    const adapter = {
      reserve: vi.fn().mockResolvedValue(created),
      claimInitialization: vi
        .fn()
        .mockResolvedValue({ attempt: reclaimed, claimed: true, fresh: false }),
      markIndeterminate: vi.fn(),
      markInitialized: vi.fn(),
      reconcileInitialization: vi.fn(),
    };
    const provider = { initialize: vi.fn(), probeInitialization: vi.fn() };
    expect(
      await initializeRedvaultCheckout({
        attemptAdapter: adapter,
        provider,
        customerEmail: 'buyer@example.test',
        orderId: 'order',
        redirectUrl: 'https://example.test',
      })
    ).toEqual({ authorizationUrl: null, status: 'pending_reconciliation' });
    expect(provider.initialize).not.toHaveBeenCalled();
  });
});
