import { z } from 'zod';
import { toOxygenMinorUnits } from '@/lib/payments/oxygen/money';

const amount = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => {
    try {
      toOxygenMinorUnits(value, 'NGN');
      return true;
    } catch {
      return false;
    }
  });
export const oxygenLoanBreakdownSchema = z.object({
  periods: z
    .array(
      z.object({
        period: z.number().int().nullable(),
        dueDate: z
          .tuple([
            z.number().int().min(2000).max(2200),
            z.number().int().min(1).max(12),
            z.number().int().min(1).max(31),
          ])
          .nullable(),
        totalInstallmentAmountForPeriod: amount.nullable(),
        principalDue: amount.nullable(),
        interestDue: amount.nullable(),
        totalOriginalDueForPeriod: amount.optional(),
      })
    )
    .max(121),
});
