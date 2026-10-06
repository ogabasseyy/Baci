import { z } from 'zod';

export const piggyvestSavingsPlanFundingRequestSchema = z.strictObject({
  goalId: z.uuid(),
  bvn: z.string().regex(/^\d{11}$/),
  reserveVirtualAccount: z.boolean().default(true),
  // Staging-gated: the provisioning request still requires
  // defaultInterestRoutingVerified before the provider enables own-wallet
  // accrual. Interest always pays into the plan's own wallet from this
  // customer-facing endpoint; external destinations stay server-configured.
  enableInterestAccrual: z.boolean().default(false),
});

export const piggyvestSavingsPlanFundingQuerySchema = z
  .object({
    goalId: z.uuid(),
    merchantId: z.uuid().optional(),
    merchantSlug: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .refine((query) => query.merchantId || query.merchantSlug, {
    message: 'A merchant identifier is required',
  });

export const piggyvestSavingsPlanFundingResponseSchema = z.strictObject({
  status: z.enum(['ready', 'pending', 'unavailable']),
  code: z
    .enum([
      'PROVISIONING_IN_PROGRESS',
      'PROVIDER_UNAVAILABLE',
      'MAPPING_PENDING',
      'NOT_CONFIGURED',
      'IDENTITY_INCOMPLETE',
    ])
    .optional(),
  accounts: z
    .array(
      z.strictObject({
        accountNumber: z.string().min(1).max(64),
        accountName: z.string().min(1).max(256),
        bankName: z.string().min(1).max(256),
      })
    )
    .max(32)
    .optional(),
});

export type PiggyvestSavingsPlanFundingResponse = z.infer<
  typeof piggyvestSavingsPlanFundingResponseSchema
>;
