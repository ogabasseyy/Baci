import { z } from 'zod';

const receiptFields = {
  submission_id: z.uuid(),
  partner_order_id: z.string(),
  received_at: z.iso.datetime({ offset: true }),
};

export const partnerOrderReceiptSchema = z.discriminatedUnion('status', [
  z.object({
    ...receiptFields,
    status: z.enum([
      'pending_verification',
      'payment_verified',
      'settlement_verified',
    ]),
  }),
  z.object({
    ...receiptFields,
    status: z.literal('review_required'),
    review_reason: z.enum([
      'SETTLEMENT_REVIEW_REQUIRED',
      'ORDER_REVIEW_REQUIRED',
    ]),
  }),
  z.object({
    ...receiptFields,
    status: z.literal('accepted'),
    order_id: z.uuid(),
  }),
]);
