import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';

import {
  createSharedCart,
  fetchSharedCartSnapshot,
  prepareSharedCartCheckout,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  isCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
  resetPendingCartDeviceRevocationsForTests,
} from './shared-cart-session-revoke-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    cartId: '22222222-2222-4222-8222-222222222222',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 3,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

describe('shared-cart-client snapshot', () => {
  beforeEach(() => {
    resetPendingCartDeviceRevocationsForTests();
    vi.clearAllMocks();
  });

  it('fetches the authorized snapshot without storing it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ cart: snapshot(), warnings: [] })
    );

    const result = await fetchSharedCartSnapshot();

    expect(result).toMatchObject({ ok: true, snapshot: { version: 3 } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/cart',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
        method: 'GET',
      })
    );
  });

  it.each([
    ['missing_proof', 404, 'unauthorized'],
    ['not_found', 404, 'not_found'],
    ['expired', 404, 'expired'],
    ['unauthorized', 401, 'unauthorized'],
  ])('maps %s to a fatal typed failure', async (code, status, expectedCode) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code }, Number(status)));

    const result = await fetchSharedCartSnapshot();

    expect(result).toEqual({
      code: expectedCode,
      ok: false,
      retryable: false,
      snapshot: null,
    });
  });

  it('treats outages and malformed bodies as retryable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'x' }, 503));
    await expect(fetchSharedCartSnapshot()).resolves.toMatchObject({
      ok: false,
      retryable: true,
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ nope: true }, 200));
    await expect(fetchSharedCartSnapshot()).resolves.toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchSharedCartSnapshot()).resolves.toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });
  });

  it('fences snapshot reads while device-session revocation is pending until revocation succeeds', async () => {
    markCartDeviceRevocationPending('ogabassey');
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ code: 'rate_limited' }, 429)
    );

    await expect(
      fetchSharedCartSnapshot(undefined, 'ogabassey')
    ).resolves.toEqual({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isCartDeviceRevocationPending('ogabassey')).toBe(true);

    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ revoked: true }, 200)
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ cart: snapshot(), warnings: [] })
    );

    await expect(
      fetchSharedCartSnapshot(undefined, 'ogabassey')
    ).resolves.toMatchObject({
      ok: true,
      snapshot: { version: 3 },
    });
    expect(isCartDeviceRevocationPending('ogabassey')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('shared-cart-client commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends one versioned command and returns the reconciled snapshot', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse(
        { cart: snapshot({ version: 4 }), replayed: false, warnings: [] },
        200
      )
    );

    const result = await sendSharedCartCommand({
      command: { item: { productId: 'prod-1' }, quantity: 1, type: 'add' },
      expectedVersion: 3,
      operationId: 'op-1',
    });

    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      snapshot: { version: 4 },
    });
    const [url, init] = vi.mocked(fetchWithCsrf).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/storefront/cart/commands');
    expect(JSON.parse(String(init?.body))).toEqual({
      command: { item: { productId: 'prod-1' }, quantity: 1, type: 'add' },
      expectedVersion: 3,
      operationId: 'op-1',
    });
  });

  it('carries the current cart on conflict responses for rebasing', async () => {
    const conflictCart = snapshot({ version: 6 });
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ cart: conflictCart, code: 'version_conflict' }, 409)
    );

    const result = await sendSharedCartCommand({
      command: { lineId: 'line-1', type: 'remove' },
      expectedVersion: 3,
      operationId: 'op-1',
    });

    expect(result).toEqual({
      code: 'version_conflict',
      ok: false,
      retryable: false,
      snapshot: conflictCart,
    });
  });

  it('maps fatal command errors without a cart to snapshot null', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ code: 'invalid_item' }, 400)
    );

    await expect(
      sendSharedCartCommand({
        command: { lineId: 'line-1', type: 'remove' },
        expectedVersion: 3,
        operationId: 'op-1',
      })
    ).resolves.toEqual({
      code: 'invalid_item',
      ok: false,
      retryable: false,
      snapshot: null,
    });
  });
});

describe('shared origin merchant routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries the merchant hint on snapshot reads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cart: snapshot() }));
    await fetchSharedCartSnapshot(undefined, 'ogabassey');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/cart?merchantSlug=ogabassey',
      expect.anything()
    );
  });

  it('carries the merchant hint on creation and mutation', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      jsonResponse({ cart: snapshot() })
    );
    await createSharedCart({ operationId: 'create-routing' }, 'ogabassey');
    await sendSharedCartCommand(
      {
        operationId: 'clear-routing',
        expectedVersion: 3,
        command: { type: 'clear' },
      },
      'ogabassey'
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      1,
      '/api/storefront/cart?merchantSlug=ogabassey',
      expect.anything()
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/storefront/cart/commands?merchantSlug=ogabassey',
      expect.anything()
    );
  });

  it('carries the merchant hint on checkout review', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      jsonResponse({ code: 'not_found' }, 404)
    );
    await prepareSharedCartCheckout(
      { cartId: 'cart', expectedVersion: 3, operationId: 'review-routing' },
      'ogabassey'
    );
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/cart/checkout?merchantSlug=ogabassey',
      expect.anything()
    );
  });
});
