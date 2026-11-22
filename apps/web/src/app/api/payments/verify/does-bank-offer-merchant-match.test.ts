import { expect, it, vi } from 'vitest';
import { doesBankOfferMerchantMatch } from './does-bank-offer-merchant-match';

it('propagates database denial and matches only the requested merchant', async () => {
  const error = new Error('lookup unavailable');
  const result = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: 'store' }, error: null })
    .mockResolvedValueOnce({ data: { id: 'other' }, error: null })
    .mockResolvedValueOnce({ data: null, error });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: result,
  };
  const client = { from: vi.fn(() => query) } as never;
  await expect(
    doesBankOfferMerchantMatch(client, 'ogabassey', 'store')
  ).resolves.toBe(true);
  await expect(
    doesBankOfferMerchantMatch(client, 'ogabassey', 'store')
  ).resolves.toBe(false);
  await expect(
    doesBankOfferMerchantMatch(client, 'ogabassey', 'store')
  ).rejects.toThrow(error);
});
