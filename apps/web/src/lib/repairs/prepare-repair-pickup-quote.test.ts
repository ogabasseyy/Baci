import { beforeEach, describe, expect, it, vi } from 'vitest';

const quoteRepairPickup = vi.hoisted(() => vi.fn());
vi.mock('./quote-repair-pickup', () => ({ quoteRepairPickup }));

import { prepareRepairPickupQuote } from './prepare-repair-pickup-quote';

const input = {
  items: [],
  merchantId: 'm1',
  receiver: {},
  sender: {},
} as unknown as Parameters<typeof prepareRepairPickupQuote>[0];

const giglQuote = (price: number, providerCost: number) => ({
  provider: 'GIGL',
  price,
  providerCost,
  platformMargin: price - providerCost,
  marginBasisPoints: 1000,
  pricingVersion: 'gigl_platform_margin_v1',
});

describe('prepareRepairPickupQuote', () => {
  beforeEach(() => {
    quoteRepairPickup.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns gigl_unavailable when the quote call throws', async () => {
    quoteRepairPickup.mockRejectedValue(new Error('boom'));
    await expect(
      prepareRepairPickupQuote({ ...input, paidPickupFee: 10_000 })
    ).resolves.toEqual({ ok: false, reason: 'gigl_unavailable' });
  });

  it('returns gigl_unavailable when there is no quote', async () => {
    quoteRepairPickup.mockResolvedValue({ quote: null, request: {} });
    await expect(
      prepareRepairPickupQuote({ ...input, paidPickupFee: 10_000 })
    ).resolves.toEqual({ ok: false, reason: 'gigl_unavailable' });
  });

  it('returns quote_increased when the price exceeds the paid fee', async () => {
    quoteRepairPickup.mockResolvedValue({
      quote: giglQuote(10_000, 9000),
      request: {},
    });
    await expect(
      prepareRepairPickupQuote({ ...input, paidPickupFee: 9835.58 })
    ).resolves.toEqual({ ok: false, reason: 'quote_increased' });
  });

  it('keeps a pre-rounding paid fee when the cost fell', async () => {
    const request = { sessionId: 's' };
    quoteRepairPickup.mockResolvedValue({
      quote: giglQuote(9900, 8940),
      request,
    });
    const result = await prepareRepairPickupQuote({
      ...input,
      paidPickupFee: 9835.58,
    });
    expect(result).toMatchObject({ ok: true, request });
    expect(result.ok && result.quote.price).toBe(9834);
  });
});
