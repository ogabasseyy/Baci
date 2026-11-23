import { bankCardOfferSchema } from './bank-card-offer';

export const bankCardOffersSchema = bankCardOfferSchema
  .array()
  .refine(
    (offers) =>
      new Set(offers.map(({ merchantId, id }) => `${merchantId}:${id}`))
        .size === offers.length,
    'Offer IDs must be unique per merchant.'
  );
