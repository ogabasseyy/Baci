import { beforeEach, expect, it, vi } from 'vitest';
import { beginCartSessionRetirement } from '@/hooks/cart/cart-session-write-fence';
import { bumpCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  readRedvaultUncertainAttempt,
  saveRedvaultUncertainAttempt,
} from '../redvault-uncertain-attempt';
import { recoverRedvaultUncertainAttempt } from './recover-redvault-uncertain-attempt';
import {
  attempt,
  cartId,
  merchantId,
  orderRequest,
  response,
  sessionId,
} from './recover-redvault-uncertain-attempt.test-support';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

it('uses the CSRF-aware client for recovery when no request override is supplied', async () => {
  saveRedvaultUncertainAttempt(attempt);
  vi.mocked(fetchWithCsrf).mockResolvedValueOnce(Response.json(response));
  expect(
    await recoverRedvaultUncertainAttempt({ merchantId, pendingOrder: null })
  ).toMatchObject({ kind: 'recovered' });
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    '/api/orders',
    expect.objectContaining({ method: 'POST' })
  );
});

it('replays the exact saved request and persists a review before clearing the attempt', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
  const result = await recoverRedvaultUncertainAttempt({
    merchantId,
    pendingOrder: null,
    request,
  });
  expect(result.kind).toBe('recovered');
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]).toEqual([
    '/api/orders',
    expect.objectContaining({
      body: JSON.stringify(orderRequest),
      headers: expect.objectContaining({
        'Idempotency-Key': 'attempt-key',
        'X-Checkout-Recovery': '1',
      }),
    }),
  ]);
  expect(
    JSON.parse(
      sessionStorage.getItem('storefront-checkout-pending-order') ?? 'null'
    )
  ).toMatchObject({
    orderId: 'order-1',
    redvaultReview: { ready: { cartId, trackingToken: 'tracking-token' } },
  });
  expect(readRedvaultUncertainAttempt(merchantId)).toEqual({ kind: 'none' });
});

it('retains the attempt if the server response or order identity cannot be confirmed', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ order: { id: 'order-1' } }), {
        status: 200,
      })
    );
  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: null,
      request,
    })
  ).toEqual({ kind: 'unavailable' });
  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: null,
      request,
    })
  ).toEqual({ kind: 'unavailable' });
  expect(readRedvaultUncertainAttempt(merchantId).kind).toBe('pending');
});

it.each([
  { ...response.order, id: '' },
  { ...response.order, tracking_token: '' },
  { ...response.order, currency: 'USD' },
  { ...response.order, total: '102.5' },
])('retains the fence for a malformed recovered order: %j', async (order) => {
  saveRedvaultUncertainAttempt(attempt);
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ...response, order }));
  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: null,
      request,
    })
  ).toEqual({ kind: 'unavailable' });
  expect(readRedvaultUncertainAttempt(merchantId).kind).toBe('pending');
});

it('keeps the existing currency normalization and order-number fallback', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      ...response,
      order: { ...response.order, currency: ' ngn ', order_number: 123 },
    })
  );
  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: null,
      request,
    })
  ).toMatchObject({
    kind: 'recovered',
    snapshot: { orderNumber: 'ORDER-1' },
  });
});

it('never overwrites an unresolved request with a changed checkout', () => {
  saveRedvaultUncertainAttempt(attempt);
  expect(() =>
    saveRedvaultUncertainAttempt({
      ...attempt,
      idempotencyKey: 'different-key',
    })
  ).toThrow();
  const stored = readRedvaultUncertainAttempt(merchantId);
  expect(stored.kind === 'pending' && stored.attempt.idempotencyKey).toBe(
    'attempt-key'
  );
});

it('allows a fresh review only after the server retires the exact expired checkout', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const key = `baci:uba-uncertain-checkout:${merchantId}`;
  const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null');
  stored.createdAt = Date.now() - 31 * 60_000;
  sessionStorage.setItem(key, JSON.stringify(stored));

  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      kind: 'retired',
      cartId,
      checkoutSessionId: sessionId,
      checkoutGeneration: 1,
    })
  );

  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      merchantSlug: 'store',
      pendingOrder: null,
      request,
    })
  ).toEqual({ kind: 'retired' });
  expect(readRedvaultUncertainAttempt(merchantId)).toEqual({ kind: 'none' });
});

it('restores an already submitted UBA order after the checkout window expires', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const key = `baci:uba-uncertain-checkout:${merchantId}`;
  const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null');
  stored.createdAt = Date.now() - 31 * 60_000;
  sessionStorage.setItem(key, JSON.stringify(stored));
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ kind: 'submitted', ...response }));

  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      merchantSlug: 'store',
      pendingOrder: null,
      request,
    })
  ).toMatchObject({ kind: 'recovered', snapshot: { orderId: 'order-1' } });
  expect(readRedvaultUncertainAttempt(merchantId)).toEqual({ kind: 'none' });
});

it('keeps an uncertain attempt when retirement names a different checkout', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const key = `baci:uba-uncertain-checkout:${merchantId}`;
  const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null');
  stored.createdAt = Date.now() - 31 * 60_000;
  sessionStorage.setItem(key, JSON.stringify(stored));
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      kind: 'retired',
      cartId,
      checkoutSessionId: 'other',
      checkoutGeneration: 1,
    })
  );

  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: null,
      request,
    })
  ).toEqual({ kind: 'unavailable' });
  expect(readRedvaultUncertainAttempt(merchantId).kind).toBe('pending');
});

it('does not replay over a different pending order', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const request = vi.fn<typeof fetch>();
  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: { orderId: 'other' } as never,
      request,
    })
  ).toEqual({ kind: 'unavailable' });
  expect(request).not.toHaveBeenCalled();
});

it('does not replay or clear the attempt after recovery is cancelled', async () => {
  saveRedvaultUncertainAttempt(attempt);
  const request = vi.fn<typeof fetch>();
  const controller = new AbortController();
  controller.abort();
  expect(
    await recoverRedvaultUncertainAttempt({
      merchantId,
      pendingOrder: null,
      request,
      signal: controller.signal,
    })
  ).toEqual({ kind: 'unavailable' });
  expect(request).not.toHaveBeenCalled();
  expect(readRedvaultUncertainAttempt(merchantId).kind).toBe('pending');
});

it('does not persist an old shopper review if logout begins during recovery', async () => {
  saveRedvaultUncertainAttempt(attempt);
  let finish!: (response: Response) => void;
  let started!: () => void;
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  const request = vi.fn<typeof fetch>().mockImplementation(() => {
    started();
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const pending = recoverRedvaultUncertainAttempt({
    merchantId,
    merchantSlug: 'store',
    pendingOrder: null,
    request,
  });
  await reached;
  const retirement = beginCartSessionRetirement('store');
  bumpCartSessionGeneration({ merchantSlug: 'store' });
  try {
    finish(new Response(JSON.stringify(response), { status: 200 }));
    expect(await pending).toEqual({ kind: 'unavailable' });
    expect(
      sessionStorage.getItem('storefront-checkout-pending-order')
    ).toBeNull();
    expect(readRedvaultUncertainAttempt(merchantId).kind).toBe('pending');
  } finally {
    retirement.release();
  }
});
