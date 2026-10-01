import { z } from 'zod';
import { referenceSchema } from './payments';

export const guestPaymentVerificationQuerySchema = z
  .object({
    reference: referenceSchema,
    trackingToken: z.string().trim().min(1).max(256),
  })
  .strict();

export type GuestPaymentVerificationQuery = z.infer<
  typeof guestPaymentVerificationQuerySchema
>;
