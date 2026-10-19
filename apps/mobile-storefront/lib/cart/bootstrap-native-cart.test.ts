import { bootstrapNativeCart } from './bootstrap-native-cart';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const config = {
  apiOrigin: 'https://api.test',
  merchantId: MERCHANT_ID,
  merchantSlug: 'ogabassey',
};

function storageWith(existing: string | null) {
  return { get: jest.fn().mockResolvedValue(existing) };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

it('returns the stored proof without contacting the server', async () => {
  const fetcher = jest.fn();
  const persist = jest.fn();
  await expect(
    bootstrapNativeCart(
      config,
      storageWith('cp1.stored.signature') as never,
      fetcher as never,
      () => {},
      persist
    )
  ).resolves.toEqual({ proof: 'cp1.stored.signature' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
});

it('bootstraps through the CSRF handshake and persists the proof', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ token: 'csrf-token-1' }))
    .mockResolvedValueOnce(
      jsonResponse({
        proof: 'cp1.fresh.signature',
        merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
      })
    );
  const persist = jest.fn().mockResolvedValue(undefined);
  await expect(
    bootstrapNativeCart(
      config,
      storageWith(null) as never,
      fetcher as never,
      () => {},
      persist
    )
  ).resolves.toEqual({ proof: 'cp1.fresh.signature' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const bootstrapCall = fetcher.mock.calls[1];
  expect(bootstrapCall[0]).toContain(
    '/api/storefront/cart/bootstrap?merchantSlug=ogabassey'
  );
  expect(bootstrapCall[1].headers['x-csrf-token']).toBe('csrf-token-1');
  expect(bootstrapCall[1].headers.Cookie).toBe(
    '__Host-csrf-token=csrf-token-1'
  );
  expect(persist).toHaveBeenCalledWith({ proof: 'cp1.fresh.signature' });
});

it('fails closed on a malformed CSRF reply', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValue(jsonResponse({ token: 'bad token!' }));
  await expect(
    bootstrapNativeCart(
      config,
      storageWith(null) as never,
      fetcher as never,
      () => {},
      jest.fn()
    )
  ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
});

it('fails closed when the bootstrap reply names another merchant', async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ token: 'csrf-token-1' }))
    .mockResolvedValueOnce(
      jsonResponse({
        proof: 'cp1.fresh.signature',
        merchant: { id: '22222222-2222-4222-8222-222222222222' },
      })
    );
  await expect(
    bootstrapNativeCart(
      config,
      storageWith(null) as never,
      fetcher as never,
      () => {},
      jest.fn()
    )
  ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
});

it('wraps transport failures as temporarily unavailable', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(
    bootstrapNativeCart(
      config,
      storageWith(null) as never,
      fetcher as never,
      () => {},
      jest.fn()
    )
  ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
});
