import 'server-only';
import { allocateRedvaultRefund } from '@baci/shared/lib';
import type { BankCardOfferQuote } from './bank-card-offer-payment';

export function calculateBankCardOfferMerchandiseRefund({
  quote,
  itemId,
  returnedUnitIndexes,
}: {
  quote: BankCardOfferQuote;
  itemId: string;
  returnedUnitIndexes: readonly number[];
}) {
  const allocation = quote.allocations.find((item) => item.itemId === itemId);
  if (!allocation)
    throw new Error('Refund item is outside the bank offer quote');
  return allocateRedvaultRefund(allocation, returnedUnitIndexes);
}
