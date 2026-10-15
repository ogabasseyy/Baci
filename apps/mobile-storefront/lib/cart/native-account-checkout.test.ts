import { createNativeAccountCheckout } from './native-account-checkout';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '99999999-9999-4999-8999-999999999999';
const SHOPPER_TOKEN = 'shopper-jwt';

const makeProof = (changes: Record<string, unknown> = {}) =>
  `cp1.${Buffer.from(
    JSON.stringify({
      merchantId: MERCHANT_ID,
      principalId: 'guest-1',
      scope: 'session',
      cartId: CART_ID,
      exp: 9999999999,
      ...changes,
    })
  ).toString('base64url')}.signature`;

const cart = {
  cartId: CART_ID,
  merchantId: MERCHANT_ID,
  state: 'active',
  version: 2,
  currency: 'NGN',
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00.000Z',
  lines: [],
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    merchant: MERCHANT_ID,
    url: (route: string) => `https://api.test${route}`,
    storage: {},
    fetcher: jest.fn(),
    assertCurrent: jest.fn(),
    getShopperToken: jest.fn().mockResolvedValue(SHOPPER_TOKEN),
    getOwnerSubject: jest.fn().mockReturnValue(OWNER_ID),
    readProof: jest.fn().mockResolvedValue(makeProof()),
    readCart: jest.fn(),
    keepProof: jest.fn().mockResolvedValue(undefined),
    send: jest.fn(),
    ...overrides,
  };
}

it('keeps shopper and cart authority in separate headers and persists the rotated proof', async () => {
  const deps = makeDeps();
  deps.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ cart, linkedUserId: OWNER_ID, proof: makeProof() }),
      { status: 200 }
    )
  );
  const checkout = createNativeAccountCheckout(deps as never);
  const reply = await checkout.linkAccount({ operationId: 'op-1' } as never);
  expect(reply.linkedUserId).toBe(OWNER_ID);
  const [, init] = deps.fetcher.mock.calls[0];
  expect(init.headers.Authorization).toBe(`Bearer ${SHOPPER_TOKEN}`);
  expect(init.headers['X-Cart-Session-Proof']).toBe(makeProof());
  // The rotated proof is required to adopt the linked cart.
  expect(deps.keepProof).toHaveBeenCalledWith(
    expect.objectContaining({ proof: makeProof() }),
    true,
    expect.objectContaining({ kind: 'account', operationId: 'op-1' })
  );
});

it('persists the renewed proof returned by checkout preparation', async () => {
  const renewedProof = makeProof();
  const deps = makeDeps();
  deps.send.mockResolvedValue({
    snapshot: { cartId: CART_ID, merchantId: MERCHANT_ID },
    proof: renewedProof,
    replayed: false,
    sessionReused: false,
  });
  const checkout = createNativeAccountCheckout(deps as never);
  const result = await checkout.prepareCheckout({
    cartId: CART_ID,
    expectedVersion: 2,
    operationId: 'op-prepare',
  });
  expect(result.snapshot.cartId).toBe(CART_ID);
  expect(deps.keepProof).toHaveBeenCalledWith(
    expect.objectContaining({ proof: renewedProof })
  );
});

it('does not touch stored proof when preparation returns none', async () => {
  const deps = makeDeps();
  deps.send.mockResolvedValue({
    snapshot: { cartId: CART_ID, merchantId: MERCHANT_ID },
    replayed: true,
    sessionReused: true,
  });
  const checkout = createNativeAccountCheckout(deps as never);
  const result = await checkout.prepareCheckout({
    cartId: CART_ID,
    expectedVersion: 2,
    operationId: 'op-prepare-replay',
  });
  expect(result.replayed).toBe(true);
  expect(deps.keepProof).not.toHaveBeenCalled();
});

it('refuses to link without a stored cart proof', async () => {
  const deps = makeDeps({ readProof: jest.fn().mockResolvedValue(null) });
  const checkout = createNativeAccountCheckout(deps as never);
  await expect(
    checkout.linkAccount({ operationId: 'op-1' } as never)
  ).rejects.toMatchObject({ code: 'missing_proof' });
  expect(deps.fetcher).not.toHaveBeenCalled();
});

it('surfaces a retryable failure when the reply omits the rotated proof', async () => {
  const deps = makeDeps();
  // The pre-fix server behavior: link committed but no proof returned,
  // so the client must fail rather than adopt a cart it cannot use.
  deps.fetcher.mockResolvedValue(
    new Response(JSON.stringify({ cart, linkedUserId: OWNER_ID }), {
      status: 200,
    })
  );
  const checkout = createNativeAccountCheckout(deps as never);
  await expect(
    checkout.linkAccount({ operationId: 'op-1' } as never)
  ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
  expect(deps.keepProof).not.toHaveBeenCalled();
});

it('rejects a link receipted to another account subject', async () => {
  const deps = makeDeps();
  deps.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        cart,
        linkedUserId: '88888888-8888-4888-8888-888888888888',
        proof: makeProof(),
      }),
      { status: 200 }
    )
  );
  const checkout = createNativeAccountCheckout(deps as never);
  await expect(
    checkout.linkAccount({ operationId: 'op-1' } as never)
  ).rejects.toMatchObject({ code: 'session_changed' });
});

it('reads the saved account cart through the same separated headers', async () => {
  const deps = makeDeps();
  deps.fetcher.mockResolvedValue(
    new Response(JSON.stringify({ cart }), { status: 200 })
  );
  const checkout = createNativeAccountCheckout(deps as never);
  const reply = await checkout.savedAccountCart();
  expect(reply.cart?.cartId).toBe(CART_ID);
  const [url, init] = deps.fetcher.mock.calls[0];
  expect(url).toBe('https://api.test/account');
  expect(init.method).toBe('GET');
  expect(init.headers['X-Cart-Session-Proof']).toBe(makeProof());
});
