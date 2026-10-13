import { z } from 'zod';

const merchantIdList = z
  .array(z.uuid())
  .max(500)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Target merchant IDs must be unique',
      });
    }
  });

export const notificationTargetingSchema = z
  .strictObject({
    target_type: z.enum(['all', 'specific', 'segment']).optional(),
    target_merchant_ids: merchantIdList.optional(),
    target_segment: z.enum(['new', 'active', 'at_risk']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.target_type === 'specific' && !data.target_merchant_ids?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Target merchant IDs required for specific targeting',
        path: ['target_merchant_ids'],
      });
    }
    if (data.target_type === 'segment' && !data.target_segment) {
      ctx.addIssue({
        code: 'custom',
        message: 'Target segment required for segment targeting',
        path: ['target_segment'],
      });
    }
  });

export const notificationTargetMerchantIdsSchema = merchantIdList;
