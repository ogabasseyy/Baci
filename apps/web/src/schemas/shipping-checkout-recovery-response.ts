import { z } from 'zod';

export const shippingCheckoutRecoveryConfirmationSchema = z.object({
  quoteId: z.uuid(),
  confirmed: z.literal(true),
});
