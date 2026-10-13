import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  prepareSharedCartCheckout,
  sendSharedCartCommand,
} from './shared-cart-client';

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
    expiresAt: '2026-10-19T04:00:00.000Z',
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
    ['missing_proof', 404],
    ['not_found', 404],
    ['expired', 404],
    ['unauthorized', 401],
  ])('maps %s to a fatal typed failure', async (code, status) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code }, status));

    const result = await fetchSharedCartSnapshot();

    expect(result).toEqual({
      code,
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
});

describe('shared-cart-client bootstrap and create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bootstraps with the slug hint and reads the created proof implicitly', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ expiresAt: 'x', merchant: {}, proof: 'cp1.x' }, 201)
    );

    const result = await bootstrapSharedCart('ogabassey');

    expect(result).toEqual({ ok: true });
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/cart/bootstrap',
      expect.objectContaining({ method: 'POST' })
    );
    const [, init] = vi.mocked(fetchWithCsrf).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      merchantSlug: 'ogabassey',
    });
  });

  it('marks quota exhaustion retryable and validation fatal', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ code: 'quota_exceeded' }, 429)
    );
    await expect(bootstrapSharedCart()).resolves.toEqual({
      code: 'quota_exceeded',
      ok: false,
      retryable: true,
    });

    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ code: 'invalid_request' }, 400)
    );
    await expect(bootstrapSharedCart()).resolves.toEqual({
      code: 'invalid_request',
      ok: false,
      retryable: false,
    });
  });

  it('creates a cart with lines and returns the snapshot', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ cart: snapshot({ version: 1 }), proof: 'cp1.y' }, 201)
    );

    const result = await createSharedCart({
      lines: [{ item: { productId: 'prod-1' }, quantity: 2 }],
      operationId: 'op-create-1',
    });

    expect(result).toMatchObject({ ok: true, snapshot: { version: 1 } });
    const [, init] = vi.mocked(fetchWithCsrf).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      operationId: 'op-create-1',
    });
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
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse(
        { cart: snapshot({ version: 6 }), code: 'version_conflict' },
        409
      )
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
      snapshot: snapshot({ version: 6 }),
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

describe('shared-cart-client product hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockProductsQuery(rows: unknown[] | null, error: unknown = null) {
    const query = {
      eq: vi.fn(),
      in: vi.fn(),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockImplementation((column: string) =>
      column === 'status' ? { data: rows, error } : query
    );
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => query),
    } as never);
    return query;
  }

  it('fetches active merchant products and resolves their images', async () => {
    const query = mockProductsQuery([
      {
        brand: 'Brand',
        gtin: '',
        id: 'prod-1',
        image_hint: 'phone',
        images: ['https://img.test/phone.png'],
        manage_stock: false,
        merchant_id: 'merchant-1',
        mpn: '',
        name: 'Phone',
        price: 100,
        status: 'active',
        stock: 10,
      },
    ]);

    const products = await fetchSharedCartProducts(['prod-1'], 'merchant-1');

    expect(query.in).toHaveBeenCalledWith('id', ['prod-1']);
    expect(products.get('prod-1')).toMatchObject({
      id: 'prod-1',
      image: 'https://img.test/phone.png',
      imageLarge: 'https://img.test/phone.png',
      name: 'Phone',
    });
  });

  it('skips the query for empty ids and degrades to empty on error', async () => {
    await expect(fetchSharedCartProducts([], 'merchant-1')).resolves.toEqual(
      new Map()
    );
    expect(createClient).not.toHaveBeenCalled();

    mockProductsQuery(null, new Error('catalog down'));
    await expect(
      fetchSharedCartProducts(['prod-1'], 'merchant-1')
    ).resolves.toEqual(new Map());
  });
});

describe('shared-cart-client checkout prepare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const REVIEW_SNAPSHOT = {
    cartId: '22222222-2222-4222-8222-222222222222',
    cartVersion: 3,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    estimates: {
      currency: 'NGN',
      lineCount: 1,
      subtotalMinor: 25000,
      unavailableCount: 0,
    },
    generation: 1,
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
  };

  it('prepares checkout and returns the session reference', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({
        replayed: false,
        sessionReused: false,
        snapshot: REVIEW_SNAPSHOT,
      })
    );

    const result = await prepareSharedCartCheckout({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-1',
    });

    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/cart/checkout',
      expect.objectContaining({ method: 'POST' })
    );
    const [, init] = vi.mocked(fetchWithCsrf).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-1',
    });
    expect(result).toEqual({
      ok: true,
      replayed: false,
      review: {
        cartId: '22222222-2222-4222-8222-222222222222',
        cartVersion: 3,
        checkoutSessionId: '55555555-5555-4555-8555-555555555555',
        currency: 'NGN',
        generation: 1,
        merchantId: '11111111-1111-4111-8111-111111111111',
        subtotalMinor: 25000,
        unavailableCount: 0,
      },
      sessionReused: false,
    });
  });

  it('surfaces refresh_required with the live version', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse(
        {
          code: 'refresh_required',
          currentVersion: 4,
          error: 'Cart changed.',
        },
        409
      )
    );

    const result = await prepareSharedCartCheckout({
      cartId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 3,
      operationId: 'prep-op-1',
    });

    expect(result).toEqual({
      code: 'refresh_required',
      currentVersion: 4,
      ok: false,
      retryable: false,
    });
  });

  it('fails closed on malformed snapshots and transport errors', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ replayed: false, sessionReused: false, snapshot: {} })
    );

    await expect(
      prepareSharedCartCheckout({
        cartId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 3,
        operationId: 'prep-op-1',
      })
    ).resolves.toMatchObject({ code: 'temporarily_unavailable', ok: false });

    vi.mocked(fetchWithCsrf).mockRejectedValueOnce(new Error('offline'));
    await expect(
      prepareSharedCartCheckout({
        cartId: '22222222-2222-4222-8222-222222222222',
        expectedVersion: 3,
        operationId: 'prep-op-1',
      })
    ).resolves.toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
    });
  });
});
