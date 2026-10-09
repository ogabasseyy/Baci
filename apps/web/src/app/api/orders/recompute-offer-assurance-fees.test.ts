import { describe, expect, it } from 'vitest';
import {
  roundCurrency,
  SERVER_ASSURANCE_RATE,
} from '@/lib/immediate-order-notification';
import { recomputeOfferAssuranceFees } from './recompute-offer-assurance-fees';

describe('recomputeOfferAssuranceFees', () => {
  it('recomputes the fee from the live offer price', () => {
    const lines = [
      {
        product_id: 'p-1',
        offer_id: 'offer-1',
        has_assurance: true,
        assurance_fee: 0,
        quantity: 2,
      },
    ];

    recomputeOfferAssuranceFees(lines, new Map([['p-1::offer-1', 800]]), {
      applied: false,
      negotiation: null,
    });

    expect(lines[0]?.assurance_fee).toBe(
      roundCurrency(800 * 2 * SERVER_ASSURANCE_RATE)
    );
  });

  it('subtracts the validated per-unit reduction only when applied', () => {
    const lines = [
      {
        product_id: 'p-1',
        offer_id: 'offer-1',
        has_assurance: true,
        assurance_fee: 0,
        quantity: 2,
      },
    ];
    const negotiation = { lineDiscounts: [{ merchandiseDiscount: 100 }] };

    recomputeOfferAssuranceFees(lines, new Map([['p-1::offer-1', 800]]), {
      applied: true,
      negotiation,
    });

    expect(lines[0]?.assurance_fee).toBe(
      roundCurrency((800 - 100 / 2) * 2 * SERVER_ASSURANCE_RATE)
    );
  });

  it('skips lines without an offer, assurance, or verified price', () => {
    const lines = [
      {
        product_id: 'p-1',
        offer_id: null,
        has_assurance: true,
        assurance_fee: 11,
        quantity: 1,
      },
      {
        product_id: 'p-1',
        offer_id: 'offer-1',
        has_assurance: false,
        assurance_fee: 12,
        quantity: 1,
      },
      {
        product_id: 'p-1',
        offer_id: 'offer-9',
        has_assurance: true,
        assurance_fee: 13,
        quantity: 1,
      },
    ];

    recomputeOfferAssuranceFees(lines, new Map([['p-1::offer-1', 800]]), {
      applied: false,
      negotiation: null,
    });

    expect(lines.map((line) => line.assurance_fee)).toEqual([11, 12, 13]);
  });

  it('leaves every line untouched when no offer price is verified', () => {
    const lines = [
      {
        product_id: 'p-1',
        offer_id: 'offer-1',
        has_assurance: true,
        assurance_fee: 7,
        quantity: 1,
      },
    ];

    recomputeOfferAssuranceFees(lines, new Map(), {
      applied: false,
      negotiation: null,
    });

    expect(lines[0]?.assurance_fee).toBe(7);
  });
});
