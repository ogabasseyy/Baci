import { z } from 'zod';
import { bankCardOfferPaymentContextSchema } from './bank-card-offer-payment-context';

export const bankCardOfferCheckoutContextSchema =
  bankCardOfferPaymentContextSchema.extend({
    subaccount: z.string().regex(/^ACCT_[a-zA-Z0-9]+$/),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  });
