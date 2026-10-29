import { expect, it, vi } from 'vitest';
import { reconcileRedvaultUncertainAttempt } from './reconcile-redvault-uncertain-attempt';

const binding = {
  cart_id: '22222222-2222-4222-8222-222222222222',
  cart_version: 2,
  checkout_generation: 3,
  checkout_session_id: '44444444-4444-4444-8444-444444444444',
};
const attempt = {
  idempotencyKey: 'attempt-key',
  customer: { email: 'ada@example.test' },
  parsedOrder: { shared_cart: binding },
};

it('sends the saved session binding and accepts only its matching retirement receipt', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        kind: 'retired',
        cartId: binding.cart_id,
        checkoutSessionId: binding.checkout_session_id,
        checkoutGeneration: binding.checkout_generation,
      })
    );
  const signal = new AbortController().signal;
  expect(
    await reconcileRedvaultUncertainAttempt({
      attempt: attempt as never,
      merchantSlug: 'shop',
      request,
      signal,
    })
  ).toEqual({ kind: 'retired' });
  expect(request).toHaveBeenCalledWith(
    '/api/storefront/cart/checkout/reconcile?merchantSlug=shop',
    expect.objectContaining({
      method: 'POST',
      signal,
      body: JSON.stringify({
        cartId: binding.cart_id,
        sessionId: binding.checkout_session_id,
        generation: 3,
        cartVersion: 2,
        customerEmail: 'ada@example.test',
        idempotencyKey: 'attempt-key',
      }),
    })
  );
});

it('does not retire the saved attempt for a different checkout or an unavailable server', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        kind: 'retired',
        cartId: binding.cart_id,
        checkoutSessionId: 'different',
        checkoutGeneration: 3,
      })
    )
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  const input = {
    attempt: attempt as never,
    request,
    signal: new AbortController().signal,
  };
  expect(await reconcileRedvaultUncertainAttempt(input)).toEqual({
    kind: 'unavailable',
  });
  expect(await reconcileRedvaultUncertainAttempt(input)).toEqual({
    kind: 'unavailable',
  });
});
