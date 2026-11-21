import { describe, expect, it } from 'vitest';
import { quoteBankCardOffer } from './bank-card-offer-quote';
import {
  items,
  merchantId,
  now,
  offer,
  productId,
} from './bank-card-offer-quote.test-support';

describe('bank card offer quotes', () => {
  it('retains a zero refundable value when a unit is fully discounted by rounding', () => {
    const quote = quoteBankCardOffer({
      offer: { ...offer, discountBasisPoints: 9_999 },
      merchantId,
      items: [
        { itemId: 'one-kobo', productId, unitPriceKobo: 1, quantity: 1 },
        ...items.slice(1),
      ],
      now,
    });

    if (!quote)
      throw new Error('Expected a rounded discount on the first line');
    expect(quote.discountKobo).toBe(1);
    expect(quote.allocations[0]).toMatchObject({
      itemId: 'one-kobo',
      unitNetAmountsKobo: [0],
    });
  });

  it('caps the discount and records the net amounts per eligible unit', () => {
    const quote = quoteBankCardOffer({ offer, merchantId, items, now });
    expect(quote).toMatchObject({
      productSubtotalKobo: 22_000,
      eligibleSubtotalKobo: 20_000,
      discountKobo: 999,
      paymentPolicy: {
        partnership: 'wema-launch',
        bankCode: '035',
        issuerName: 'Wema Bank',
        cardBrands: ['visa'],
      },
      allocations: [
        { itemId: 'first', unitNetAmountsKobo: [9500, 9501] },
        { itemId: 'second', unitNetAmountsKobo: [2000] },
      ],
    });
  });

  it.each([
    { enabled: false },
    { startsAt: 'invalid' },
    { endsAt: 'invalid' },
    { startsAt: '2026-11-28T00:00:00+01:00' },
    { endsAt: '2026-11-27T12:00:00+01:00' },
    { eligibleProductIds: [] },
    { merchantId: 'another-merchant' },
  ])('rejects an inapplicable offer %j', (override) => {
    expect(
      quoteBankCardOffer({
        offer: { ...offer, ...override },
        merchantId,
        items,
        now,
      })
    ).toBeNull();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects quantity %s', (quantity) => {
    expect(() =>
      quoteBankCardOffer({
        offer,
        merchantId,
        items: [{ ...items[0], quantity }],
        now,
      })
    ).toThrow('quantity');
  });

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects unit amount %s', (unitPriceKobo) => {
    expect(() =>
      quoteBankCardOffer({
        offer,
        merchantId,
        items: [{ ...items[0], unitPriceKobo }],
        now,
      })
    ).toThrow('unit price');
  });

  it('rejects cumulative unit and money overflow', () => {
    expect(() =>
      quoteBankCardOffer({
        offer,
        merchantId,
        items: items.map((item) => ({ ...item, quantity: 6_000 })),
        now,
      })
    ).toThrow('quantity');
    expect(() =>
      quoteBankCardOffer({
        offer,
        merchantId,
        items: [{ ...items[0], unitPriceKobo: Number.MAX_SAFE_INTEGER }],
        now,
      })
    ).toThrow('safe integer');
  });

  it('accepts the exact campaign start and rounds up a half kobo', () => {
    expect(
      quoteBankCardOffer({
        offer,
        merchantId,
        items: [
          { ...items[0], unitPriceKobo: 30, quantity: 1 },
          { ...items[1], unitPriceKobo: 0 },
        ],
        now: Date.parse(offer.startsAt),
      })
    ).toMatchObject({
      discountKobo: 2,
      allocations: [{ unitNetAmountsKobo: [28] }, { unitNetAmountsKobo: [0] }],
    });
  });

  it.each([
    { basisPoints: 4000, discountKobo: 2, firstNet: 1, secondNet: 2 },
    { basisPoints: 6000, discountKobo: 3, firstNet: 0, secondNet: 2 },
  ])('rounds cumulative allocations for an odd subtotal at $basisPoints basis points', ({
    basisPoints,
    discountKobo,
    firstNet,
    secondNet,
  }) => {
    expect(
      quoteBankCardOffer({
        offer: { ...offer, discountBasisPoints: basisPoints },
        merchantId,
        items: [
          { ...items[0], unitPriceKobo: 1, quantity: 1 },
          { ...items[1], productId, unitPriceKobo: 4, quantity: 1 },
        ],
        now,
      })
    ).toMatchObject({
      eligibleSubtotalKobo: 5,
      discountKobo,
      allocations: [
        { unitNetAmountsKobo: [firstNet] },
        { unitNetAmountsKobo: [secondNet] },
      ],
    });
  });

  it('matches uppercase catalog UUIDs and preserves integer kobo for decimal prices', () => {
    expect(
      quoteBankCardOffer({
        offer: { ...offer, eligibleProductIds: [productId.toUpperCase()] },
        merchantId,
        items: [
          {
            ...items[0],
            productId: productId.toUpperCase(),
            unitPriceKobo: 1999,
            quantity: 1,
          },
        ],
        now,
      })
    ).toMatchObject({
      productSubtotalKobo: 1999,
      discountKobo: 100,
      allocations: [
        { productId, unitPriceKobo: 1999, unitNetAmountsKobo: [1899] },
      ],
    });
  });

  it('rejects a discount that rounds to the whole merchandise total', () => {
    expect(
      quoteBankCardOffer({
        offer: { ...offer, discountBasisPoints: 9_999 },
        merchantId,
        items: [{ ...items[0], unitPriceKobo: 25, quantity: 1 }],
        now,
      })
    ).toBeNull();
  });

  it('rejects ambiguous line membership and unbounded quantities', () => {
    expect(() =>
      quoteBankCardOffer({
        offer,
        merchantId,
        items: [items[0], items[0]],
        now,
      })
    ).toThrow('unique');
    expect(() =>
      quoteBankCardOffer({
        offer,
        merchantId,
        items: [{ ...items[0], quantity: 10_001 }],
        now,
      })
    ).toThrow('quantity');
  });
});
