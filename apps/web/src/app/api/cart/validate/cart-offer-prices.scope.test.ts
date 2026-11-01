import { expect, it, vi } from 'vitest';
import { fetchCartOfferPrices } from './cart-offer-prices';

const p = '11111111-1111-4111-8111-111111111111';
const q = '22222222-2222-4222-8222-222222222222';
const offer = '55555555-5555-4555-8555-555555555555';
const merchant = '33333333-3333-4333-8333-333333333333';
it('scopes each guest offer lookup by the authoritative product owner', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await fetchCartOfferPrices(
    rpc,
    [
      { id: p, offerId: offer },
      { id: q, offerId: offer },
    ],
    [
      { id: p, merchant_id: merchant },
      { id: q, merchant_id: q },
    ]
  );
  expect(rpc).toHaveBeenCalledWith({
    p_merchant_id: merchant,
    p_product_ids: [p],
  });
  expect(rpc).toHaveBeenCalledWith({ p_merchant_id: q, p_product_ids: [q] });
  expect(rpc.mock.calls.every(([args]) => args.p_merchant_id !== null)).toBe(
    true
  );
});
it('fails closed for an offer whose product owner cannot be resolved', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await expect(
    fetchCartOfferPrices(
      rpc,
      [{ id: p, offerId: offer }],
      [{ id: p, merchant_id: '' }]
    )
  ).rejects.toThrow('merchant');
  expect(rpc).not.toHaveBeenCalled();
});
