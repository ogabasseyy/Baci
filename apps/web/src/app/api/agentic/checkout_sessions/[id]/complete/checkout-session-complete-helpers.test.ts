import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerError = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

import {
  agenticCompleteFailureResponse,
  resolveAgenticSharedCartPrincipalId,
} from './checkout-session-complete-helpers';

const bindingMetadata = {
  agentic: {
    shared_cart: {
      cart_id: 'cart-1',
      cart_version: 3,
      checkout_generation: 1,
      checkout_session_id: 'session-1',
    },
  },
};

function clientReturning(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row }),
        }),
      }),
    }),
  };
}

describe('resolveAgenticSharedCartPrincipalId', () => {
  it('returns null when the metadata carries no shared-cart binding', async () => {
    await expect(
      resolveAgenticSharedCartPrincipalId({
        bootstrap: clientReturning(null) as never,
        merchantId: 'merchant-1',
        metadata: {},
      })
    ).resolves.toBeNull();
  });

  it('resolves the preparing principal from the server-side session row', async () => {
    await expect(
      resolveAgenticSharedCartPrincipalId({
        bootstrap: clientReturning({
          cart_id: 'cart-1',
          merchant_id: 'merchant-1',
          principal_id: 'guest-a1',
        }) as never,
        merchantId: 'merchant-1',
        metadata: bindingMetadata,
      })
    ).resolves.toBe('guest-a1');
  });

  it('fails closed on merchant or cart mismatches', async () => {
    await expect(
      resolveAgenticSharedCartPrincipalId({
        bootstrap: clientReturning({
          cart_id: 'cart-1',
          merchant_id: 'merchant-2',
          principal_id: 'guest-a1',
        }) as never,
        merchantId: 'merchant-1',
        metadata: bindingMetadata,
      })
    ).resolves.toBeNull();
  });
});

describe('agenticCompleteFailureResponse', () => {
  beforeEach(() => {
    mockLoggerError.mockClear();
  });

  it('logs and returns the generic 500', async () => {
    const response = await agenticCompleteFailureResponse({
      error: new Error('boom'),
      respondWithIdempotency: null,
      sessionId: 'session-1',
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Internal Server Error',
    });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it('stores the failure through the idempotency responder when present', async () => {
    const stored = new Response('stored', { status: 500 });
    const respondWithIdempotency = vi.fn(async () => stored as never);

    const response = await agenticCompleteFailureResponse({
      error: new Error('boom'),
      respondWithIdempotency,
      sessionId: 'session-1',
    });

    expect(response).toBe(stored);
    expect(respondWithIdempotency).toHaveBeenCalledWith(
      { error: 'Internal Server Error' },
      500
    );
  });
});
