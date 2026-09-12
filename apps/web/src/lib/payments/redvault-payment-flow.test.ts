import { describe, expect, it, vi } from 'vitest';
import {
  initializeRedvaultPayment,
  reconcileRedvaultCapture,
} from './redvault-payment-flow';

const snapshot = {
  amountKobo: 9500,
  currency: 'NGN' as const,
  merchantId: 'merchant',
  orderId: 'order',
  quotePayloadHash: 'a'.repeat(64),
};

describe('REDVAULT payment flow', () => {
  it('persists an immutable attempt before initializing the hosted session', async () => {
    const events: string[] = [];
    const result = await initializeRedvaultPayment({
      attemptStore: {
        findLive: vi.fn().mockResolvedValue(null),
        mark: vi.fn().mockImplementation(async () => events.push('mark')),
        persist: vi.fn().mockImplementation(async (input) => {
          events.push('persist');
          return input;
        }),
      },
      provider: {
        initialize: vi.fn().mockImplementation(async (input) => {
          events.push('provider');
          expect(input.metadata.custom_filters).toEqual({
            banks: ['033'],
            card_brands: ['verve', 'visa', 'mastercard'],
          });
          return { authorizationUrl: 'https://checkout.test' };
        }),
      },
      bankCode: '033',
      snapshot,
    });
    expect(events).toEqual(['persist', 'provider', 'mark']);
    expect(result.status).toBe('initialized');
  });

  it.each([
    'created',
    'initialized',
    'indeterminate',
    'captured_held',
  ] as const)('does not initialize an existing %s attempt again', async (state) => {
    const attempt = {
      ...snapshot,
      id: 'attempt',
      reference: 'RV-existing',
      state,
    };
    const provider = { initialize: vi.fn() };
    const result = await initializeRedvaultPayment({
      attemptStore: {
        findLive: vi.fn().mockResolvedValue(attempt),
        mark: vi.fn(),
        persist: vi.fn(),
      },
      provider,
      bankCode: '033',
      snapshot,
    });
    expect(result.status).toBe('pending_reconciliation');
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('records successful but unproven captures as held without approval', async () => {
    const mark = vi.fn();
    await expect(
      reconcileRedvaultCapture({
        attempt: {
          ...snapshot,
          id: 'attempt',
          reference: 'RV-1',
          state: 'initialized',
        },
        attemptStore: { findLive: vi.fn(), mark, persist: vi.fn() },
        capture: {
          amount: 9500,
          authorization: { brand: 'visa', channel: 'card' },
          currency: 'NGN',
          reference: 'RV-1',
          status: 'success',
        },
      })
    ).resolves.toBe('held');
    expect(mark).toHaveBeenCalledWith({
      id: 'attempt',
      state: 'captured_held',
    });
  });
});
