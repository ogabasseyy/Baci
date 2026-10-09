import { describe, expect, it } from 'vitest';
import type { OrderOfferQueryResult } from '@/lib/checkout/verify-order-offer-lines';
import {
  roundCurrency,
  SERVER_ASSURANCE_RATE,
} from '@/lib/immediate-order/order-item-primitives';
import { prepareAgenticOfferEconomics } from './prepare-agentic-offer-economics';

const productId = '22222222-2222-4222-8222-222222222222';
const offerId = '33333333-3333-4333-8333-333333333333';

function liveOffers(
  offers: { offer_id: string; price: number; condition: string }[] = [
    { offer_id: offerId, price: 400_000, condition: 'open_box' },
  ]
): OrderOfferQueryResult {
  return { data: offers, error: null };
}

function offerLine(overrides: Record<string, unknown> = {}) {
  return {
    assurance_fee: 0,
    condition: 'Open Box',
    has_assurance: true,
    offer_id: offerId,
    product_id: productId,
    quantity: 1,
    ...overrides,
  };
}

describe('prepareAgenticOfferEconomics', () => {
  it('verifies offer lines and returns the shared live price map', async () => {
    const items = [offerLine()];
    const result = await prepareAgenticOfferEconomics(
      async () => liveOffers(),
      items
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveOfferPrices.get(`${productId}::${offerId}`)).toBe(
      400_000
    );
  });

  it('reconciles the stored condition and recomputes assurance from the live basis', async () => {
    const items = [offerLine()];
    const result = await prepareAgenticOfferEconomics(
      async () => liveOffers(),
      items
    );

    expect(result.ok).toBe(true);
    expect(items[0].condition).toBe('open_box');
    expect(items[0].assurance_fee).toBe(
      roundCurrency(400_000 * 1 * SERVER_ASSURANCE_RATE)
    );
  });

  it('passes plain lines through with an empty live map', async () => {
    const items = [offerLine({ offer_id: null })];
    const result = await prepareAgenticOfferEconomics(
      async () => liveOffers(),
      items
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveOfferPrices.size).toBe(0);
    expect(items[0].assurance_fee).toBe(0);
  });

  it('returns a 400 dispatch result when the offer is not live', async () => {
    const items = [offerLine()];
    const result = await prepareAgenticOfferEconomics(
      async () =>
        liveOffers([
          {
            offer_id: '44444444-4444-4444-8444-444444444444',
            price: 350_000,
            condition: 'open_box',
          },
        ]),
      items
    );

    expect(result).toEqual({
      ok: false,
      result: expect.objectContaining({
        error: 'Invalid condition offer for order item',
        ok: false,
        status: 400,
      }),
    });
  });

  it('returns a 500 dispatch result when offer verification throws', async () => {
    const items = [offerLine()];
    const result = await prepareAgenticOfferEconomics(async () => {
      throw new Error('offers RPC down');
    }, items);

    expect(result).toEqual({
      ok: false,
      result: expect.objectContaining({
        error: 'Unable to verify order offers',
        ok: false,
        status: 500,
      }),
    });
  });
});
