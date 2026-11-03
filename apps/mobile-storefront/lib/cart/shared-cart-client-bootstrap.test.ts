import { createNativeCartClient } from './shared-cart-client';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('./client-credential', () => ({
  cartClientCredentialHeaders: async () => ({
    'x-baci-client-credential': '44444444-4444-4444-8444-444444444444',
  }),
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

it('bootstraps with the real CSRF handshake without fabricating Bearer [REDACTED]', async () => {
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
      'x-baci-client-credential': '44444444-4444-4444-8444-444444444444',
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
