import { bootstrapNativeCart } from './bootstrap-native-cart';

const merchantId = '11111111-1111-4111-8111-111111111111';

function setup(status: number, body: unknown) {
  const persist = jest.fn();
  const storage = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    remove: jest.fn(),
  };
  const fetcher = jest
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'csrf' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  const bootstrap = () =>
    bootstrapNativeCart(
      {
        merchantId,
        merchantSlug: 'shop',
        apiOrigin: 'https://api.example.test',
      },
      storage,
      fetcher,
      () => undefined,
      persist
    );
  return { bootstrap, persist, fetcher };
}

it('preserves the live bootstrap 429 quota response without installing a proof', async () => {
  const s = setup(429, { code: 'quota_exceeded', error: 'Rate limited' });
  await expect(s.bootstrap()).rejects.toMatchObject({
    code: 'quota_exceeded',
    indeterminate: false,
  });
  expect(s.persist).not.toHaveBeenCalled();
  expect(s.fetcher).toHaveBeenCalledTimes(2);
});

it.each<[number, unknown]>([
  [503, { code: 'temporarily_unavailable', error: 'Unavailable' }],
  [429, { code: 'not_a_cart_code', error: 'Unknown' }],
  [200, { code: 'quota_exceeded' }],
  [429, { code: 'quota_exceeded', proof: 'malformed' }],
])('keeps other bootstrap failures closed (%s)', async (status, body) => {
  const s = setup(status, body);
  await expect(s.bootstrap()).rejects.toMatchObject({
    code: 'temporarily_unavailable',
  });
  expect(s.persist).not.toHaveBeenCalled();
});

it('persists a successful merchant-matching bootstrap proof', async () => {
  const s = setup(201, {
    merchant: { id: merchantId, slug: 'shop' },
    proof: 'cp1.bootstrap.signature',
  });
  await expect(s.bootstrap()).resolves.toEqual({
    proof: 'cp1.bootstrap.signature',
  });
  expect(s.persist).toHaveBeenCalledWith({ proof: 'cp1.bootstrap.signature' });
});
