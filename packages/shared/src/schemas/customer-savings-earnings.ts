import { z } from 'zod';

export const CustomerSavingsEarningsResponseSchema = z
  .object({
    credited_interest_kobo: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
