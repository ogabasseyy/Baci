import { z } from 'zod';

export const walletFundingAccountDatabaseSchema = z.object({
  account_name: z.string().min(1),
  account_number: z.string().regex(/^\d{10,20}$/),
  bank_name: z.string().min(1),
  provider: z.literal('paystack'),
});
