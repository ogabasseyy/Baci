import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';

import { bootstrapSharedCart, createSharedCart } from './shared-cart-client';
import { resetPendingCartDeviceRevocationsForTests } from './shared-cart-session-revoke-client';

// The global setup installs a LockManager mock; these suites exercise
// the synchronous no-Web-Locks fallback path instead.
beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
});

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

describe('shared-cart-client bootstrap and create', () => {
  beforeEach(() => {
    resetPendingCartDeviceRevocationsForTests();
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

  it('coalesces concurrent bootstraps for the same merchant', async () => {
    let release: (response: Response) => void = () => {};
    vi.mocked(fetchWithCsrf).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    // Only an identical resolved merchant key may share this request.
    const first = bootstrapSharedCart('ogabassey');
    const second = bootstrapSharedCart('ogabassey');
    expect(fetchWithCsrf).toHaveBeenCalledTimes(1);
    release(jsonResponse({ expiresAt: 'x', merchant: {} }, 201));
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    // After settlement the next bootstrap is a fresh request.
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ expiresAt: 'x', merchant: {} }, 201)
    );
    await expect(bootstrapSharedCart('ogabassey')).resolves.toEqual({
      ok: true,
    });
    expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
  });

  it('keeps separate bootstrap flights for different merchants', async () => {
    const releases: ((response: Response) => void)[] = [];
    vi.mocked(fetchWithCsrf).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve);
        })
    );
    const first = bootstrapSharedCart('merchant-a');
    const second = bootstrapSharedCart('merchant-b');
    expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
    for (const release of releases)
      release(jsonResponse({ expiresAt: 'x', merchant: {} }, 201));
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('marks quota exhaustion retryable and validation fatal', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ code: 'quota_exceeded' }, 429)
    );
    await expect(bootstrapSharedCart()).resolves.toEqual({
      code: 'rate_limited',
      ok: false,
      retryable: true,
    });

    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      jsonResponse({ code: 'invalid_request' }, 400)
    );
    await expect(bootstrapSharedCart()).resolves.toEqual({
      code: 'invalid_item',
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
