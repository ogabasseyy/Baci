import { z } from 'zod';

export const replayWalletOutflowSchema = z.object({
  reference: z.string().min(1).max(200),
  amount: z.int().positive(),
  currency: z.literal('NGN'),
  source_wallet_id: z.string().min(1).max(200),
  destination_wallet_id: z.string().min(1).max(200),
  transaction_id: z.string().min(1).max(200),
  customer_id: z.string().min(1).max(200).optional(),
  business_id: z.string().min(1).max(200).optional(),
  status: z.enum(['success', 'COMPLETED']).optional(),
});
