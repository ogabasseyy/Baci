import { z } from 'zod';
import { coerceWalletDatabaseNumber } from '@/hooks/wallet-data-number';

const amount = z
  .union([z.number(), z.string()])
  .transform(coerceWalletDatabaseNumber)
  .pipe(z.number().finite());

export const WalletNumberGoalsSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      current_amount: amount,
      target_amount: amount,
      product_id: z.string().nullable(),
      variant_id: z.string().nullable(),
      title: z.string(),
      product_snapshot: z.union([
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()),
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
      ]),
      contribution_amount: amount,
      contribution_frequency: z.enum(['daily', 'weekly', 'monthly']),
      source_mode: z.enum(['manual', 'auto_debit']),
      status: z.enum(['active', 'paused', 'completed']),
      maturity_date: z.string(),
      metadata: z.string().min(1),
    })
  )
  .refine(
    (goals) => new Set(goals.map((goal) => goal.id)).size === goals.length
  );
