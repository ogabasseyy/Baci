import { z } from 'zod';
import {
  optionalMerchantId,
  optionalNonEmptyString,
  requireWalletFundingMerchantIdentifier,
} from '@/schemas/merchant-identifier';

export const piggyvestPlanIdentifiersSchema = z
  .object({
    merchantId: optionalMerchantId,
    merchantSlug: optionalNonEmptyString,
  })
  .superRefine(requireWalletFundingMerchantIdentifier);

export type PiggyvestPlanIdentifiers = z.infer<
  typeof piggyvestPlanIdentifiersSchema
>;
