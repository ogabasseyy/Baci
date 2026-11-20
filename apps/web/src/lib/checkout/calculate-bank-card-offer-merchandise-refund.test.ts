import { expect, it } from 'vitest';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import { calculateBankCardOfferMerchandiseRefund } from './calculate-bank-card-offer-merchandise-refund';

const [allocation] = bankCardOfferContextFixture.quote.allocations;
const request = {
  quote: bankCardOfferContextFixture.quote,
  itemId: allocation.itemId,
};

it('refunds the discounted amount allocated to the returned unit', () => {
  expect(
    calculateBankCardOfferMerchandiseRefund({
      ...request,
      returnedUnitIndexes: [0],
    })
  ).toMatchObject({ refundKobo: 9500 });
});

it('rejects a refund for an item outside the paid quote', () => {
  expect(() =>
    calculateBankCardOfferMerchandiseRefund({
      ...request,
      itemId: 'other',
      returnedUnitIndexes: [0],
    })
  ).toThrow('Refund item is outside the bank offer quote');
});

it.each(
  [[1], [-1], [0.5], [0, 0]].map((indexes) => ({ indexes }))
)('rejects invalid or duplicate returned unit indexes ($indexes)', ({
  indexes,
}) => {
  expect(() =>
    calculateBankCardOfferMerchandiseRefund({
      ...request,
      returnedUnitIndexes: indexes,
    })
  ).toThrow(/returned unit index/);
});
