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

// The provider sends counts as numbers and times as numbers, numeric strings
// or null (no data yet). Anything else reads as "no data", never a guess.
const count = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    const parsed = Number(value);
    return value != null && Number.isFinite(parsed) && parsed >= 0
      ? Math.trunc(parsed)
      : 0;
  });

const seconds = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  });

/** Provider summary: only the fields the Baci insights card reads. */
export const providerInboxSummarySchema = z.object({
  conversations_count: count,
  incoming_messages_count: count,
  outgoing_messages_count: count,
  resolutions_count: count,
  avg_first_response_time: seconds,
  avg_resolution_time: seconds,
});

export type MerchantInboxInsights = {
  days: MerchantInboxInsightDays;
  conversations: number;
  customerMessages: number;
  storeReplies: number;
  resolved: number;
  /** Seconds; null when there is nothing to average yet. */
  avgFirstResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
};

/** Baci's own insights response, validated again in the browser. */
export const merchantInboxInsightsResponseSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  conversations: z.number().int().nonnegative(),
  customerMessages: z.number().int().nonnegative(),
  storeReplies: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  avgFirstResponseSeconds: z.number().nonnegative().nullable(),
  avgResolutionSeconds: z.number().nonnegative().nullable(),
});
