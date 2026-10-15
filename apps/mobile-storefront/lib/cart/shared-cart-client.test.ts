import { createNativeCartClient } from './shared-cart-client';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const merchant = '11111111-1111-4111-8111-111111111111';
const cart = '22222222-2222-4222-8222-222222222222';
const snapshot = {
  merchantId: merchant,
  cartId: cart,
  version: 1,
  state: 'active',
  currency: 'NGN',
  lines: [],
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
};
function setup() {
  const storage = {
    get: jest.fn().mockResolvedValue('cp1.session.signature'),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const fetcher = jest
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ cart: snapshot })));
  return {
    storage,
    fetcher,
    client: createNativeCartClient(
      {
        merchantId: merchant,
        merchantSlug: 'shop',
        apiOrigin: 'https://usebaci.com',
      },
      storage,
      fetcher
    ),
  };
}
it('pins merchant routing, omits cookie auth, and refuses credential redirects', async () => {
  const s = setup();
  await expect(s.client.read()).resolves.toEqual(
    expect.objectContaining({ cart: snapshot })
  );
  expect(s.fetcher).toHaveBeenCalledWith(
    'https://usebaci.com/api/storefront/cart?merchantSlug=shop',
    expect.objectContaining({
      credentials: 'omit',
      redirect: 'error',
      headers: expect.objectContaining({
        Authorization: 'Bearer cp1.session.signature',
      }),
    })
  );
});
it('rejects foreign-merchant snapshots before returning or storing authority', async () => {
  const s = setup();
  s.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        cart: {
          ...snapshot,
          merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        proof: 'cp1.foreign.signature',
      })
    )
  );
  await expect(s.client.read()).rejects.toThrow('Cart request unavailable');
  expect(s.storage.set).not.toHaveBeenCalled();
});
it('links an account with separate shopper and cart authority and records the owner subject', async () => {
  const guestProof = `cp1.${Buffer.from(JSON.stringify({ merchantId: merchant, principalId: 'guest-one', scope: 'session', cartId: cart, exp: 4102444800 })).toString('base64url')}.signature`;
  const storage = {
    get: jest.fn().mockResolvedValue(guestProof),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const userId = '44444444-4444-4444-8444-444444444444';
  const fetcher = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        cart: snapshot,
        proof: 'cp1.linked.signature',
        linkedUserId: userId,
        operationId: 'link-1',
      })
    )
  );
  const client = createNativeCartClient(
    {
      merchantId: merchant,
      merchantSlug: 'shop',
      apiOrigin: 'https://usebaci.com',
      ownerSubject: userId,
    },
    storage,
    fetcher,
    () => true,
    async () => 'shopper-jwt'
  );
  await client.linkAccount({ operationId: 'link-1', choice: 'keep_current' });
  expect(fetcher).toHaveBeenCalledWith(
    'https://usebaci.com/api/storefront/cart/account?merchantSlug=shop',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: `Bearer ${'shopper-jwt'}`,
        'X-Cart-Session-Proof': guestProof,
      }),
    })
  );
  expect(storage.set).toHaveBeenCalledWith(
    merchant,
    'cp1.linked.signature',
    expect.objectContaining({
      kind: 'account',
      operationId: 'link-1',
      cartId: cart,
      ownerSubject: userId,
    })
  );
});
it('recovers a committed account link only for the same owner subject', async () => {
  const userId = '44444444-4444-4444-8444-444444444444';
  const otherUser = '55555555-5555-4555-8555-555555555555';
  const proof = `cp1.${Buffer.from(
    JSON.stringify({
      merchantId: merchant,
      principalId: 'principal-1',
      scope: 'session',
      cartId: cart,
      exp: 4102444800,
    })
  ).toString('base64url')}.signature`;
  const storage = {
    get: jest.fn().mockResolvedValue(proof),
    set: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    getPromotionReceipt: jest.fn().mockResolvedValue({
      kind: 'account',
      operationId: 'link-1',
      cartId: cart,
      ownerSubject: userId,
      fromActor: 'guest-one',
    }),
  };
  const fetcher = jest
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ cart: snapshot })));
  const client = createNativeCartClient(
    {
      merchantId: merchant,
      merchantSlug: 'shop',
      apiOrigin: 'https://usebaci.com',
      ownerSubject: userId,
    },
    storage,
    fetcher,
    () => true,
    async () => 'shopper-jwt'
  );
  await expect(
    client.recoverAccountLink('link-1', otherUser, 'guest-one')
  ).rejects.toMatchObject({ code: 'session_changed' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    client.recoverAccountLink('link-1', userId, 'guest-one')
  ).resolves.toEqual(expect.objectContaining({ cart: snapshot }));
});
it('prepares a canonical checkout review without submitting an order', async () => {
  const s = setup();
  const checkoutSnapshot = {
    checkoutSessionId: '66666666-6666-4666-8666-666666666666',
    generation: 1,
    cartVersion: 1,
    cartId: cart,
    merchantId: merchant,
    lines: [],
    estimates: {
      subtotalMinor: 0,
      currency: 'NGN',
      lineCount: 0,
      unavailableCount: 0,
    },
  };
  s.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ snapshot: checkoutSnapshot, sessionReused: true })
    )
  );
  await expect(
    s.client.prepareCheckout({
      cartId: cart,
      expectedVersion: 1,
      operationId: 'prep-1',
    })
  ).resolves.toEqual({
    snapshot: checkoutSnapshot,
    replayed: false,
    sessionReused: true,
  });
  expect(s.fetcher).toHaveBeenCalledWith(
    'https://usebaci.com/api/storefront/cart/checkout?merchantSlug=shop',
    expect.objectContaining({ method: 'POST' })
  );
});
it('never treats a storage outage as a new guest cart', async () => {
  const s = setup();
  s.storage.get.mockRejectedValue(new Error('private native detail'));
  await expect(s.client.read()).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});
it('keeps mutation outcomes indeterminate on response loss for exact-key replay', async () => {
  const s = setup();
  s.fetcher.mockRejectedValue(new Error('network lost'));
  await expect(
    s.client.command(
      {
        operationId: 'same-key',
        expectedVersion: 1,
        command: { type: 'clear' },
      },
      cart
    )
  ).rejects.toMatchObject({
    code: 'temporarily_unavailable',
    indeterminate: true,
  });
  expect(s.fetcher.mock.calls[0][1].body).toBe(
    JSON.stringify({
      operationId: 'same-key',
      expectedVersion: 1,
      command: { type: 'clear' },
    })
  );
});
it('bootstraps with the real CSRF handshake without fabricating bearer identity', async () => {
  const s = setup();
  s.storage.get.mockResolvedValue(null);
  s.fetcher
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'csrf-token' }))
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          merchant: { id: merchant, slug: 'shop' },
          proof: 'cp1.bootstrap.signature',
        }),
        { status: 201 }
      )
    );
  await s.client.bootstrap();
  expect(s.fetcher.mock.calls[0][0]).toBe('https://usebaci.com/api/csrf');
  expect(s.fetcher.mock.calls[1][1].headers).toEqual(
    expect.objectContaining({
      'x-csrf-token': 'csrf-token',
      Cookie: '__Host-csrf-token=csrf-token',
    })
  );
  expect(s.fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined();
  expect(s.storage.set).toHaveBeenCalledWith(
    merchant,
    'cp1.bootstrap.signature'
  );
});

it('keeps a committed creation indeterminate if saving its new proof fails', async () => {
  const s = setup();
  s.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ cart: snapshot, proof: 'cp1.upgraded.signature' })
    )
  );
  s.storage.set.mockRejectedValue(new Error('secure write failed'));
  await expect(
    s.client.create({ operationId: 'same-create-key' })
  ).rejects.toMatchObject({ indeterminate: true });
});
it('keeps a foreign mutation reply indeterminate instead of inventing a second attempt', async () => {
  const s = setup();
  s.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        cart: {
          ...snapshot,
          merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      })
    )
  );
  await expect(
    s.client.command(
      {
        operationId: 'same-key',
        expectedVersion: 1,
        command: { type: 'clear' },
      },
      cart
    )
  ).rejects.toMatchObject({ indeterminate: true });
});

it('does not persist a late proof after the merchant/account session changes', async () => {
  const s = setup();
  let live = true;
  let finish: (response: Response) => void = () => {};
  const fetcher = jest.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const client = createNativeCartClient(
    {
      merchantId: merchant,
      merchantSlug: 'shop',
      apiOrigin: 'https://usebaci.com',
    },
    s.storage,
    fetcher,
    () => live
  );
  const pending = client.command(
    { operationId: 'same-key', expectedVersion: 1, command: { type: 'clear' } },
    cart
  );
  await Promise.resolve();
  await Promise.resolve();
  live = false;
  finish(
    new Response(JSON.stringify({ cart: snapshot, proof: 'cp1.old.signature' }))
  );
  await expect(pending).rejects.toMatchObject({ code: 'session_changed' });
  expect(s.storage.set).not.toHaveBeenCalled();
});

it('bounds both legs of guest bootstrap with one abort signal', async () => {
  jest.useFakeTimers();
  try {
    const s = setup();
    s.storage.get.mockResolvedValue(null);
    let signal: AbortSignal | null | undefined;
    s.fetcher.mockImplementationOnce(
      async (_url: string, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
    );
    const pending = s.client.bootstrap();
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'temporarily_unavailable',
    });
    await jest.advanceTimersByTimeAsync(15001);
    expect(signal?.aborted).toBe(true);
    await rejected;
    expect(s.storage.set).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
it('does not send a saved account cart proof under a different signed-in shopper', async () => {
  const s = setup();
  const storage = {
    ...s.storage,
    getOwnerSubject: jest
      .fn()
      .mockResolvedValue('44444444-4444-4444-8444-444444444444'),
  };
  const client = createNativeCartClient(
    {
      merchantId: merchant,
      merchantSlug: 'shop',
      apiOrigin: 'https://usebaci.com',
      ownerSubject: '55555555-5555-4555-8555-555555555555',
    },
    storage,
    s.fetcher
  );
  await expect(client.read()).rejects.toMatchObject({
    code: 'session_changed',
  });
  expect(s.fetcher).not.toHaveBeenCalled();
});

it('persists the bootstrap proof from a keep_existing redemption with no destination cart', async () => {
  const s = setup();
  s.fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        cart: null,
        choice: 'keep_existing',
        proof: 'cp1.bootstrap.signature',
        replayed: false,
        warnings: [],
      })
    )
  );

  const result = await s.client.redeem({
    token: 'ch1.payload.signature',
    handoffId: cart,
    attemptId: 'pair-keep-1',
    choice: 'keep_existing',
  });

  expect(result.cart).toBeNull();
  expect(result.proof).toBe('cp1.bootstrap.signature');
  // Plain proof persistence (no cart promotion): the session continues
  // on the bootstrap proof instead of the consumed handoff.
  expect(s.storage.set).toHaveBeenCalledWith(
    merchant,
    'cp1.bootstrap.signature'
  );
});
