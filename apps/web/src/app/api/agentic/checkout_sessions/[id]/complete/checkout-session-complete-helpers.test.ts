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
    from: vi.fn(() => {
      throw new Error('unscoped table read forbidden');
    }),
    rpc: vi.fn(async () => ({
      data:
        row &&
        typeof row === 'object' &&
        'principal_id' in row &&
        'merchant_id' in row &&
        row.merchant_id === 'merchant-1'
          ? row.principal_id
          : null,
      error: null,
    })),
  };
}

describe('resolveAgenticSharedCartPrincipalId', () => {
  it('returns null when the metadata carries no shared-cart binding', async () => {
    await expect(
      resolveAgenticSharedCartPrincipalId({
        client: clientReturning(null) as never,
        merchantId: 'merchant-1',
        agenticSessionId: 'api-checkout-session',
        metadata: {},
      })
    ).resolves.toBeNull();
  });

  it('resolves the preparing principal from the server-side session row', async () => {
    await expect(
      resolveAgenticSharedCartPrincipalId({
        client: clientReturning({
          cart_id: 'cart-1',
          merchant_id: 'merchant-1',
          principal_id: 'guest-a1',
        }) as never,
        merchantId: 'merchant-1',
        agenticSessionId: 'api-checkout-session',
        metadata: bindingMetadata,
      })
    ).resolves.toBe('guest-a1');
  });

  it('fails closed on merchant or cart mismatches', async () => {
    await expect(
      resolveAgenticSharedCartPrincipalId({
        client: clientReturning({
          cart_id: 'cart-1',
          merchant_id: 'merchant-2',
          principal_id: 'guest-a1',
        }) as never,
        merchantId: 'merchant-1',
        agenticSessionId: 'api-checkout-session',
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

it('resolves a bound principal only through the session-scoped RPC', async () => {
  const client = clientReturning({
    merchant_id: 'merchant-1',
    principal_id: 'guest-a1',
  });
  await expect(
    resolveAgenticSharedCartPrincipalId({
      client: client as never,
      merchantId: 'merchant-1',
      agenticSessionId: 'api-checkout-session',
      metadata: bindingMetadata,
    })
  ).resolves.toBe('guest-a1');
  expect(client.from).not.toHaveBeenCalled();
  expect(client.rpc).toHaveBeenCalledWith(
    'commerce_cart_resolve_agentic_principal',
    {
      p_agentic_session_id: 'api-checkout-session',
      p_checkout_session_id: 'session-1',
      p_cart_id: 'cart-1',
    }
  );
});
