import { beforeEach, expect, it, vi } from 'vitest';
import { beginCartSessionRetirement } from '@/hooks/cart/cart-session-write-fence';
import { bumpCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  readRedvaultUncertainAttempt,
  saveRedvaultUncertainAttempt,
} from '../redvault-uncertain-attempt';
import { recoverRedvaultUncertainAttempt } from './recover-redvault-uncertain-attempt';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const sessionId = '44444444-4444-4444-8444-444444444444';
const fingerprint = `uba_redvault:${JSON.stringify({
  merchantId,
  customerEmail: 'ada@example.com',
  items: [{ id: 'phone' }],
})}`;
const orderRequest = {
  merchant_id: merchantId,
  customer_email: 'ada@example.com',
  customer_name: 'Ada Customer',
  customer_phone: '08000000000',
  items: [{ product_id: 'phone', name: 'Phone', quantity: 1, price: 100 }],
  subtotal: 100,
  payment_method: 'uba_redvault',
  shared_cart: {
    cart_id: cartId,
    cart_version: 1,
    checkout_generation: 1,
    checkout_session_id: sessionId,
  },
};
const attempt = {
  merchantId,
  idempotencyKey: 'attempt-key',
  fingerprint,
  customer: {
    email: 'ada@example.com',
    name: 'Ada Customer',
    phone: '08000000000',
  },
  billingAddress: {
    line1: 'Store pickup',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  orderRequest: orderRequest as never,
};
const response = {
  order: {
    id: 'order-1',
    total: 102.5,
    currency: 'NGN',
    tracking_token: 'tracking-token',
  },
  redvault: {
    quote: {
      product_subtotal_kobo: 10000,
      eligible_subtotal_kobo: 10000,
      ineligible_subtotal_kobo: 0,
      discount_kobo: 500,
      assurance_fee_kobo: 0,
      tax_kobo: 750,
      shipping_kobo: 0,
      gift_wrapping_kobo: 0,
      payable_kobo: 10250,
      mixed_basket: false,
    },
  },
};

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
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
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
