import { z } from 'zod';

/** Reporting windows the Messages page offers, in days. */
export const MERCHANT_INBOX_INSIGHT_DAYS = [7, 30, 90] as const;

export type MerchantInboxInsightDays =
  (typeof MERCHANT_INBOX_INSIGHT_DAYS)[number];

export const merchantInboxInsightsQuerySchema = z.object({
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .default(7),
});
