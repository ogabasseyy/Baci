import { expect, it, vi } from 'vitest';
import { getGiftCardQuote } from './quote';

it('fetches a new unlocked USD buying quote and rounds the total up to a kobo', async () => {
  const request = vi.fn().mockImplementation(async () =>
    Response.json({
      data: { symbol: 'USD-NGN', type: 'sell', locked: false, rate: 147999 },
    })
  );
  expect(await getGiftCardQuote(500, 1000, 'test-key', request)).toBe(813995);
  expect(await getGiftCardQuote(500, 0, 'test-key', request)).toBe(739995);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledWith(
    'https://api.spendjuice.com/exchange/quote?source_currency=NGN&target_currency=USD&lock=false',
    expect.objectContaining({ cache: 'no-store', redirect: 'error' })
  );
});

it('rejects a quote in the opposite direction', async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      data: { symbol: 'USD-NGN', type: 'buy', locked: false, rate: 142499 },
    })
  );
  await expect(getGiftCardQuote(500, 0, 'test-key', request)).rejects.toThrow(
    'Gift card pricing is temporarily unavailable'
  );
});
