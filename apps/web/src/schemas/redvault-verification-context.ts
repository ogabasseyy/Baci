import { z } from 'zod';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

export const redvaultVerificationContextSchema = z
  .object({
    acceptedFilterPolicyHash: z.string().regex(/^[a-f0-9]{64}$/),
    amountKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal('NGN'),
    customerEmail: z.string().email(),
    issuerName: z.string().trim().min(1),
    merchantId: z.literal(OGABASSEY_MERCHANT_ID),
    orderId: z.string().uuid(),
    reference: z.string().regex(/^RV-[A-Za-z0-9_-]{1,97}$/),
    transactionId: z.string().uuid(),
    verificationDomain: z.enum(['test', 'live']),
  })
  .strict();
