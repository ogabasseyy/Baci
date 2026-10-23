import { z } from 'zod';
export const onboardingStageSchema = z.enum([
  'welcome',
  'day1',
  'day3',
  'day5',
  'day7',
]);
export const onboardingJobSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  stage: onboardingStageSchema,
  claim_token: z.uuid(),
});
export const journeyContextSchema = z.object({
  merchant_id: z.uuid(),
  email: z.email(),
  business_name: z.string(),
  confirmed: z.boolean(),
  enabled: z.boolean(),
  reply_to: z.email().nullable(),
  opt_out_token: z.uuid(),
  is_published: z.boolean(),
  provisioned: z.boolean(),
  slug: z.string().nullable(),
  country: z.string().nullable(),
  payout_currency: z.string().nullable(),
  has_contact: z.boolean(),
  bank_configured: z.boolean(),
  paystack_configured: z.boolean(),
  feature_settings: z.object({
    paystack_enabled: z.boolean().nullable(),
    korapay_enabled: z.boolean().nullable(),
    pay_on_delivery_enabled: z.boolean().nullable(),
  }),
  identity_verified: z.boolean(),
  active_product_count: z.number().int().nonnegative(),
});
export type JourneyContext = z.infer<typeof journeyContextSchema>;
export type OnboardingJob = z.infer<typeof onboardingJobSchema>;

export const onboardingOptOutTokenSchema = z.uuid();
