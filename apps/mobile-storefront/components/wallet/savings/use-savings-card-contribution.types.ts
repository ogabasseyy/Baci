import type { z } from 'zod';
import type { SavingsCardContributionOperationSchema } from '@/schemas/savings-card-contributions';

export type SavingsCardContributionOperation = z.infer<
  typeof SavingsCardContributionOperationSchema
>;

export type SavingsCardContributionMethod = {
  id: string;
  brand: string;
  last4: string;
};

export type UseSavingsCardContributionInput = {
  amount: string;
  goalId: string;
  merchantId: string;
  onAmountChange: (amount: string) => void;
  onRefreshWallet?: () => Promise<unknown>;
  remainingAmount: number;
  userId: string;
};
