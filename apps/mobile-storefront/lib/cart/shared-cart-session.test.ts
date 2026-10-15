import { createNativeCartSession } from './shared-cart-session';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';

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

function makeDeps(overrides: Record<string, unknown> = {}) {
  const storage = {
    get: jest.fn().mockResolvedValue(null),
    getSession: jest
      .fn()
      .mockResolvedValue({ proof: makeProof(), ownerSubject: null }),
    getPromotionReceipt: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(undefined),
    ...(overrides.storage as object),
  };
  return {
    assertCurrent: jest.fn(),
    config: {
      apiOrigin: 'https://api.test',
      merchantId: MERCHANT_ID,
      merchantSlug: 'ogabassey',
    },
    fetcher: jest.fn(),
    keepProof: jest.fn().mockResolvedValue(undefined),
    merchant: MERCHANT_ID,
    origin: 'https://api.test',
    read: jest.fn(),
    ...overrides,
    storage,
  };
}

it('exposes the local context for a valid stored proof', async () => {
  const session = createNativeCartSession(makeDeps() as never);
  await expect(session.context()).resolves.toEqual({
    actor: 'guest-1',
    cartId: CART_ID,
  });
});

it('returns no context when no proof is stored', async () => {
  const session = createNativeCartSession(
    makeDeps({
      storage: { getSession: jest.fn().mockResolvedValue(null) },
    }) as never
  );
  await expect(session.context()).resolves.toBeNull();
});

it('rejects a malformed stored proof as invalid', async () => {
  const session = createNativeCartSession(
    makeDeps({
      storage: {
        getSession: jest.fn().mockResolvedValue({
          proof: 'cp1.invalid.signature',
          ownerSubject: null,
        }),
      },
    }) as never
  );
  await expect(session.context()).rejects.toMatchObject({
    code: 'invalid_proof',
  });
});

it('fails reads that return no cart', async () => {
  const deps = makeDeps();
  deps.read.mockResolvedValue({ cart: null });
  const session = createNativeCartSession(deps as never);
  await expect(session.read()).rejects.toMatchObject({
    code: 'temporarily_unavailable',
  });
});

it('refuses device retirement when storage cannot retain the proof', async () => {
  const session = createNativeCartSession(makeDeps() as never);
  await expect(session.retireDevice()).rejects.toMatchObject({
    code: 'storage_unavailable',
  });
});

it('recovers a creation only for its recorded operation and cart', async () => {
  const receipt = { kind: 'create', operationId: 'op-1', cartId: CART_ID };
  const deps = makeDeps({
    storage: {
      getPromotionReceipt: jest.fn().mockResolvedValue(receipt),
    },
  });
  deps.read.mockResolvedValue({ cart: { cartId: CART_ID } });
  const session = createNativeCartSession(deps as never);
  await expect(session.recoverCreation('op-1')).resolves.toEqual({
    cart: { cartId: CART_ID },
  });
  expect(deps.read).toHaveBeenCalledWith('', 'GET', undefined, CART_ID);
  await expect(session.recoverCreation('other-op')).resolves.toBeNull();
});

it('bootstraps to the already-stored proof without network work', async () => {
  const deps = makeDeps({
    storage: { get: jest.fn().mockResolvedValue('cp1.stored.signature') },
  });
  const session = createNativeCartSession(deps as never);
  await expect(session.bootstrap()).resolves.toEqual({
    proof: 'cp1.stored.signature',
  });
  expect(deps.fetcher).not.toHaveBeenCalled();
});

it('removes a structurally valid expired proof so bootstrap can replace it', async () => {
  const deps = makeDeps({
    storage: {
      getSession: jest.fn().mockResolvedValue({
        proof: makeProof({ exp: 1 }),
        ownerSubject: null,
      }),
    },
  });
  await expect(
    createNativeCartSession(deps as never).context()
  ).resolves.toBeNull();
  expect(deps.storage.remove).toHaveBeenCalledWith(MERCHANT_ID);
});
