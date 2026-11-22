import 'server-only';
import { BANK_CARD_OFFERS } from '@/config/bank-card-offers';
import type { BankCardOffer } from '@/schemas/bank-card-offer';

export type BrowserBankCardOffer = Pick<
  BankCardOffer,
  | 'id'
  | 'eligibleProductIds'
  | 'discountBasisPoints'
  | 'maximumDiscountKobo'
  | 'startsAt'
  | 'endsAt'
  | 'cardBrands'
  | 'verifiedIssuerName'
>;

export function getBrowserBankCardOffers(
  merchantId: string
): BrowserBankCardOffer[] {
  // The checkout preview enforces startsAt/endsAt and updates at both
  // boundaries so a cached page can show offers as they become active.
  const normalizedMerchantId = merchantId.toLowerCase();
  return BANK_CARD_OFFERS.filter(
    (offer) =>
      offer.enabled && offer.merchantId.toLowerCase() === normalizedMerchantId
  ).map(
    ({
      id,
      eligibleProductIds,
      discountBasisPoints,
      maximumDiscountKobo,
      startsAt,
      endsAt,
      cardBrands,
      verifiedIssuerName,
    }) => ({
      id,
      eligibleProductIds,
      discountBasisPoints,
      maximumDiscountKobo,
      startsAt,
      endsAt,
      cardBrands,
      verifiedIssuerName,
    })
  );
}
