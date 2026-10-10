import { z } from 'zod';
import {
  optionalMerchantId,
  optionalNonEmptyString,
  requireMerchantIdentifier,
} from '@/schemas/merchant-identifier';

export const customerSavingsVariantRecoverySchema = z
  .strictObject({
    goalId: z.uuid(),
    merchantId: optionalMerchantId,
    merchantSlug: optionalNonEmptyString,
    variantId: z.uuid(),
  })
  .superRefine(requireMerchantIdentifier);
