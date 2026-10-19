import z from 'zod';

const positiveSafeIntegerSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => Number.isSafeInteger(Number(value)))
  .transform(Number);

export const transferOutboxFinalitySchemas = {
  storeConfig: z.object({
    expectedSystemId: z.string().regex(/^\d{1,20}$/),
    businessId: z.string().min(1),
    integrationId: z.string().min(1),
  }),
  lookup: z.object({
    reference: z.string().min(1).max(200),
    providerCustomerId: z.string().min(1),
  }),
  expectedRow: z.object({
    customer_id: z.uuid(),
    reference: z.string().min(1).max(200),
    amount_kobo: z.union([z.int().positive(), positiveSafeIntegerSchema]),
    currency: z.literal('NGN'),
    source_wallet_id: z.string().min(1),
    destination_ref: z.string().min(1),
    direction: z.enum(['bank', 'wallet']),
    provider_customer_id: z.string().min(1),
    business_id: z.string().min(1),
    integration_id: z.string().min(1),
    status: z.enum(['submitted', 'succeeded', 'failed']),
  }),
  terminalOutcome: z.enum([
    'applied',
    'duplicate',
    'terminal-conflict',
    'not-submitted',
  ]),
  terminalOutcomeRow: z
    .object({
      outcome: z.enum([
        'applied',
        'duplicate',
        'terminal-conflict',
        'not-submitted',
      ]),
    })
    .strict(),
};
