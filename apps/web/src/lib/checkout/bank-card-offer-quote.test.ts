import { describe, expect, it } from 'vitest';
import type { BankCardOffer } from '@/schemas/bank-card-offer';
import {
  bankCardOfferAuthorization,
  calculateBankCardOfferMerchandiseRefund,
  verifyBankCardOfferAttempt,
} from './bank-card-offer-payment';
import { quoteBankCardOffer } from './bank-card-offer-quote';

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

  it('uses the original issuer, networks and payable total after offer edits', () => {
    const mutableOffer = { ...offer, cardBrands: [...offer.cardBrands] };
    const quote = quoteBankCardOffer({
      offer: mutableOffer,
      merchantId,
      items,
      now,
    });
    if (!quote) throw new Error('Expected an eligible order');
    const attempt = {
      quote,
      acceptedFilterPolicyHash: 'f'.repeat(64),
      amountKobo: 22_500,
      currency: 'NGN' as const,
      customerEmail: 'buyer@example.test',
      domain: 'test' as const,
      reference: 'offer-test-1',
    };
    mutableOffer.verifiedIssuerName = 'Different Bank';
    mutableOffer.cardBrands.splice(0, 1, 'mastercard');
    mutableOffer.enabled = false;
    expect(bankCardOfferAuthorization(attempt).custom_filters).toEqual({
      banks: ['035'],
      card_brands: ['visa'],
    });
    const verifiedData = {
      amount: attempt.amountKobo,
      currency: attempt.currency,
      customer: { email: attempt.customerEmail },
      domain: attempt.domain,
      reference: attempt.reference,
      channel: 'card',
      authorization: { bank: 'Wema Bank', brand: 'visa', channel: 'card' },
      id: 42,
      status: 'success',
      paid_at: '2026-11-28T12:00:00Z',
    };
    expect(
      verifyBankCardOfferAttempt(attempt, { status: true, data: verifiedData })
    ).toMatchObject({ issuerName: 'Wema Bank', amountKobo: 22_500 });
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
            bank: 'Sterling Bank',
          },
        },
      })
    ).toBeNull();
  });

  it.each([
    { enabled: false },
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
