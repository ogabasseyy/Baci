import { z } from 'zod';
import type { MerchantInboxInsightDays } from './merchant-inbox-insights-query';

export type MerchantInboxInsights = {
  days: MerchantInboxInsightDays;
  conversations: number;
  customerMessages: number;
  storeReplies: number;
  resolved: number;
  /** Seconds; null when there is nothing to average yet. */
  avgFirstResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  /** Conversations the assistant answered alone; null when unreadable. */
  handledByAi: number | null;
  /** Conversations a person took over; null when unreadable. */
  handledByMerchant: number | null;
};

/** Baci's own insights response, validated again in the browser. */
export const merchantInboxInsightsResponseSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  conversations: z.number().int().nonnegative(),
  customerMessages: z.number().int().nonnegative(),
  storeReplies: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  avgFirstResponseSeconds: z.number().int().nonnegative().nullable(),
  avgResolutionSeconds: z.number().int().nonnegative().nullable(),
  handledByAi: z.number().int().nonnegative().nullable(),
  handledByMerchant: z.number().int().nonnegative().nullable(),
});
