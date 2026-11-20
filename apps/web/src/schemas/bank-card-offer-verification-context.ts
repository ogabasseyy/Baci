import { z } from 'zod';
import { bankCardOfferPaymentContextSchema } from './bank-card-offer-payment-context';
import { bankCardOfferReferenceSchema } from './bank-card-offer-reference';

export const bankCardOfferVerificationContextSchema =
  bankCardOfferPaymentContextSchema.extend({
    reference: bankCardOfferReferenceSchema,
    acceptedFilterPolicyHash: z.string().regex(/^[0-9a-f]{64}$/),
    domain: z.enum(['test', 'live']),
    completedGatewayResponse: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  });
