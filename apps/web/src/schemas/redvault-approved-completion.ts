import { z } from 'zod';
import { orderGatewayPaymentCompletionSchema } from './order-gateway-payment-completion';

export const redvaultApprovedCompletionSchema = z
  .object({
    completion: orderGatewayPaymentCompletionSchema.refine(
      (completion) =>
        !completion.error_code &&
        completion.payment_status === 'paid' &&
        completion.order_cancelled === false &&
        completion.cancelled_at === null,
      'REDVAULT completion must confirm a paid order'
    ),
    duplicate: z.boolean(),
    inventoryConfirmed: z.literal(true),
    inventoryReclaimedUnitCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    kind: z.literal('approved'),
  })
  .strict();
