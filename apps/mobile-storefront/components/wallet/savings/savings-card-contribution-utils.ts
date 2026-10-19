import type { z } from 'zod';
import type { SavingsCardContributionOperationSchema } from '@/schemas/savings-card-contributions';

type Operation = z.infer<typeof SavingsCardContributionOperationSchema>;

export const savingsCardContributionUtils = {
  formatAmount(amountKobo: number) {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountKobo / 100);
  },
  amountToKobo(amount: string) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
    if (!match) return null;
    const value =
      Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  },
  operationMessage(operation: Operation) {
    if (operation.status === 'reconciliation_required')
      return 'This contribution needs review. Do not submit another charge.';
    if (operation.status === 'collection_failed')
      return 'The card contribution could not be collected. No retry was started.';
    return 'Contribution is pending. Check its status before taking another action.';
  },
};
