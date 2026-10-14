import { previewNativeHandoff } from './handoff-preview';

const merchant = '11111111-1111-4111-8111-111111111111';
const handoffId = '22222222-2222-4222-8222-222222222222';
const cart = {
  merchantId: merchant,
  cartId: handoffId,
  version: 1,
  state: 'active',
  currency: 'NGN',
  lines: [],
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
};
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
it('previews by public id only, binds both merchant projections, and sends no session or pairing token', async () => {
  const fetcher = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: 'pending',
        merchant: { id: merchant, slug: 'shop' },
        snapshot: cart,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      })
    )
  );
  await expect(
    previewNativeHandoff(
      {
        merchantId: merchant,
        merchantSlug: 'shop',
        apiOrigin: 'https://usebaci.com',
      },
      handoffId,
      fetcher
    )
  ).resolves.toMatchObject({ snapshot: cart });
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://usebaci.com/api/storefront/cart/handoff?merchantSlug=shop&handoff_id=${handoffId}`
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
  });
  expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        status: 'pending',
        merchant: { id: handoffId, slug: 'other' },
        snapshot: cart,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      })
    )
  );
  await expect(
    previewNativeHandoff(
      {
        merchantId: merchant,
        merchantSlug: 'shop',
        apiOrigin: 'https://usebaci.com',
      },
      handoffId,
      fetcher
    )
  ).rejects.toThrow();
});
