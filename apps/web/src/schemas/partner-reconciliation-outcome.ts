import { z } from 'zod';
import { partnerOrderReceiptSchema } from '@/schemas/partner-order-receipt';

export const outcomeSchema = z
  .object({
    receipt: partnerOrderReceiptSchema,
    hold_reason: z
      .enum(['SETTLEMENT_REVIEW_REQUIRED', 'ORDER_REVIEW_REQUIRED'])
      .nullable(),
  })
  .refine(
    ({ receipt, hold_reason }) =>
      hold_reason ===
      (receipt.status === 'review_required' ? receipt.review_reason : null)
  );
