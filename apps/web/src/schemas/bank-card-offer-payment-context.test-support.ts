import type { BankCardOfferQuote } from '@/lib/checkout/bank-card-offer-payment';

const id = '123e4567-e89b-12d3-a456-426614174000';

export const bankCardOfferContextFixture = {
  quote: {
    merchantId: id,
    approvedTermsReference: 'signed-test-terms',
    endsAt: '2035-01-01T00:00:00Z',
    paymentPolicy: {
      partnership: 'black-friday',
      bankCode: '035',
      issuerName: 'Wema Bank',
      cardBrands: ['visa'],
    },
    productSubtotalKobo: 10_000,
    eligibleSubtotalKobo: 10_000,
    discountKobo: 500,
    allocations: [
      {
        itemId: id,
        productId: id,
        quantity: 1,
        unitPriceKobo: 10_000,
        unitNetAmountsKobo: [9500],
      },
    ],
  } satisfies BankCardOfferQuote,
  amountKobo: 9500,
  customerEmail: 'customer@example.test',
};
