import { z } from 'zod';
import {
  optionalMerchantId,
  optionalNonEmptyString,
  requireMerchantIdentifier,
} from './merchant-identifier';

export const customerSavingsNonpaymentSchemas = {
  identifiers: z
    .object({
      merchantId: optionalMerchantId,
      merchantSlug: optionalNonEmptyString,
    })
    .superRefine(requireMerchantIdentifier),
  actorId: z.uuid(),
  merchant: z.object({ id: z.uuid(), slug: z.string().nullable() }),
  customer: z.object({
    id: z.uuid(),
    merchant_id: z.uuid(),
    user_id: z.uuid(),
  }),
  settingsInput: z.strictObject({ customerId: z.uuid(), merchantId: z.uuid() }),
  settingsRows: z
    .array(
      z.object({ customer_device_savings_enabled: z.boolean().nullable() })
    )
    .max(1),
};
