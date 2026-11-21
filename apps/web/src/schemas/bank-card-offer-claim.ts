import { z } from 'zod';
import { bankCardOfferCheckoutUrlSchema } from './bank-card-offer-checkout-url';
import { bankCardOfferReferenceSchema } from './bank-card-offer-reference';

export const bankCardOfferClaimSchema = z.union([
  z.object({
    claimed: z.boolean(),
    reference: bankCardOfferReferenceSchema,
    checkoutUrl: bankCardOfferCheckoutUrlSchema.nullable(),
  }),
  z.strictObject({ retired: z.literal(true) }),
]);
