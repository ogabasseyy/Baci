import { describe, expect, it } from 'vitest';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import { bankCardOfferAuthorization } from './bank-card-offer-authorization';
import { verifyBankCardOfferAttempt } from './bank-card-offer-payment';
import { quoteBankCardOffer } from './bank-card-offer-quote';
import { calculateBankCardOfferMerchandiseRefund } from './calculate-bank-card-offer-merchandise-refund';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const productId = '821516a6-f4b4-427e-83fb-757ed7658082';
const now = Date.parse('2026-11-27T12:00:00+01:00');
const offer: BankCardOffer = {
  id: 'wema-launch',
  merchantId,
  bankCode: '035',
  displayName: 'Wema',
  verifiedIssuerName: 'Wema Bank',
  cardBrands: ['visa'],
  eligibleProductIds: [productId],
  discountBasisPoints: 500,
  maximumDiscountKobo: 999,
  startsAt: '2026-11-27T00:00:00+01:00',
  endsAt: '2026-11-28T00:00:00+01:00',
  approvedTermsReference: 'example-approval',
  enabled: true,
};

const items = [
  { itemId: 'first', productId, unitPriceKobo: 10_000, quantity: 2 },
  {
    itemId: 'second',
    productId: 'unlisted',
    unitPriceKobo: 2_000,
    quantity: 1,
  },
];

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
    expect(
      calculateBankCardOfferMerchandiseRefund({
        quote,
        itemId: 'one-kobo',
        returnedUnitIndexes: [0],
      }).refundKobo
    ).toBe(0);
  });

  it('caps the discount and freezes the net refunds per eligible unit', () => {
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
    if (!quote) throw new Error('Expected an eligible order');
    expect(
      calculateBankCardOfferMerchandiseRefund({
        quote,
        itemId: 'first',
        returnedUnitIndexes: [1],
      }).refundKobo
    ).toBe(9501);
  });

  it.each([
    ['035', 'Wema Bank', '232', 'Sterling Bank'],
    ['232', 'Sterling Bank', '035', 'Wema Bank'],
  ] as const)('verifies the booked %s issuer and refund after offer edits', (bankCode, issuerName, otherCode, otherIssuerName) => {
    const mutableOffer = {
      ...offer,
      bankCode,
      verifiedIssuerName: issuerName,
      cardBrands: [...offer.cardBrands],
    };
    const quote = quoteBankCardOffer({
      offer: mutableOffer,
      merchantId,
      items,
      now,
    });
    if (!quote) throw new Error('Expected an eligible order');
    const attempt = {
      quote,
      acceptedFilterPolicyHash: hashBankCardOfferFilter(quote.paymentPolicy),
      amountKobo: 22_500,
      adjustmentsKobo: 1499,
      currency: 'NGN' as const,
      customerEmail: 'buyer@example.test',
      domain: 'test' as const,
      reference: 'offer-test-1',
    };
    mutableOffer.verifiedIssuerName =
      bankCode === '035' ? 'Sterling Bank' : 'Wema Bank';
    mutableOffer.cardBrands.splice(0, 1, 'mastercard');
    mutableOffer.enabled = false;
    expect(bankCardOfferAuthorization(attempt).custom_filters).toEqual({
      banks: [bankCode],
      card_brands: ['visa'],
    });
    const verifiedData = {
      amount: attempt.amountKobo,
      currency: attempt.currency,
      customer: { email: attempt.customerEmail },
      domain: attempt.domain,
      reference: attempt.reference,
      channel: 'card',
      authorization: { bank: issuerName, brand: 'visa', channel: 'card' },
      id: 42,
      status: 'success',
      paid_at: '2026-11-28T12:00:00Z',
    };
    expect(
      verifyBankCardOfferAttempt(
        {
          ...attempt,
          quote: {
            ...quote,
            paymentPolicy: { ...quote.paymentPolicy, bankCode: otherCode },
          },
        },
        { status: true, data: verifiedData }
      )
    ).toBeNull();
    expect(
      verifyBankCardOfferAttempt(attempt, { status: true, data: verifiedData })
    ).toMatchObject({ issuerName, amountKobo: 22_500 });
    expect(
      verifyBankCardOfferAttempt(attempt, {
        status: true,
        data: { ...verifiedData, amount: 22_499 },
      })
    ).toBeNull();
    expect(
      verifyBankCardOfferAttempt(attempt, {
        status: true,
        data: {
          ...verifiedData,
          authorization: {
            ...verifiedData.authorization,
            bank: otherIssuerName,
          },
        },
      })
    ).toBeNull();
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
