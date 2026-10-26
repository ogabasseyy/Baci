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
      status: z.enum(['active', 'paused', 'completed']),
    })
  )
  .refine(
    (goals) => new Set(goals.map((goal) => goal.id)).size === goals.length
  );
