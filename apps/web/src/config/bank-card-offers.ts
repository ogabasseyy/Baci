import 'server-only';
import {
  type BankCardOffer,
  bankCardOfferSchema,
} from '@/schemas/bank-card-offer';

// Add bank-approved terms after the checkout and persistence paths are wired.
const configuredOffers: readonly BankCardOffer[] = [];

export const BANK_CARD_OFFERS = bankCardOfferSchema
  .array()
  .refine(
    (offers) =>
      new Set(offers.map(({ merchantId, id }) => `${merchantId}:${id}`))
        .size === offers.length,
    'Offer IDs must be unique per merchant.'
  )
  .parse(configuredOffers);
