import { z } from 'zod';

export const PlanWalletSnapshotSchema = z.object({
  status: z.enum(['none', 'provisioning', 'ready', 'restricted']),
  walletId: z.string().min(1).nullable(),
  accountNumber: z.string().nullable(),
  accountName: z.string().nullable(),
  bankName: z.string().nullable(),
  balanceKobo: z.number().int().nonnegative(),
  paidInterestKobo: z.number().int().nonnegative(),
  pendingAccrualKobo: z.number().int().nonnegative(),
});

export type PlanWalletSnapshotResponse = z.infer<
  typeof PlanWalletSnapshotSchema
>;
