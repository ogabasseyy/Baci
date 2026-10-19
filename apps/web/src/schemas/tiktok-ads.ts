import { z } from 'zod';
import {
  ADS_ANALYTICS_MAX_DAYS,
  ADS_SYNC_MAX_DAYS,
  getInclusiveAdsDateRangeDays,
} from '@/lib/analytics/ads-sync-limits';

export const MAX_TIKTOK_ADS_SYNC_DAYS = ADS_SYNC_MAX_DAYS.tiktok_ads;
export const tiktokAdsOAuthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
});
const tiktokAdvertiserId = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\s]+$/, 'Invalid TikTok advertiser id');
export const tiktokAdsAccountSelectionSchema = z.object({
  accountId: tiktokAdvertiserId,
});
function dateOrder(
  value: { startDate?: string; endDate?: string },
  context: z.RefinementCtx
) {
  if (value.startDate && value.endDate && value.startDate > value.endDate)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startDate must be on or before endDate',
      path: ['startDate'],
    });
}
export const tiktokAdsSpendQuerySchema = z
  .object({
    accountId: tiktokAdvertiserId.optional(),
    endDate: z.string().date().optional(),
    startDate: z.string().date().optional(),
  })
  .superRefine((value, context) => {
    dateOrder(value, context);
    if (
      value.startDate &&
      value.endDate &&
      value.startDate <= value.endDate &&
      getInclusiveAdsDateRangeDays(value.startDate, value.endDate) >
        MAX_TIKTOK_ADS_SYNC_DAYS
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Spend range cannot exceed ${MAX_TIKTOK_ADS_SYNC_DAYS} days`,
        path: ['endDate'],
      });
  });
export const tiktokAdsSyncRequestSchema = z
  .object({
    endDate: z.string().date(),
    finalChunk: z.boolean().default(true),
    startDate: z.string().date(),
    syncRunId: z.string().uuid().optional(),
    syncRunStartedAt: z.iso.datetime({ offset: true }).optional(),
    syncWindowEndDate: z.string().date().optional(),
    syncWindowStartDate: z.string().date().optional(),
  })
  .superRefine((value, context) => {
    if (value.syncRunId && !value.syncRunStartedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'syncRunStartedAt is required when syncRunId is provided',
        path: ['syncRunStartedAt'],
      });
    }
    dateOrder(value, context);
    if (value.startDate > value.endDate) return;
    const days = getInclusiveAdsDateRangeDays(value.startDate, value.endDate);
    if (days > MAX_TIKTOK_ADS_SYNC_DAYS)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sync range cannot exceed ${MAX_TIKTOK_ADS_SYNC_DAYS} days`,
        path: ['endDate'],
      });
    validateSyncWindow(value, context);
  });

function validateSyncWindow(
  value: {
    endDate: string;
    startDate: string;
    syncWindowEndDate?: string;
    syncWindowStartDate?: string;
  },
  context: z.RefinementCtx
): void {
  const { syncWindowEndDate, syncWindowStartDate } = value;
  if (!syncWindowStartDate && !syncWindowEndDate) return;
  if (!syncWindowStartDate || !syncWindowEndDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'syncWindowStartDate and syncWindowEndDate must be provided together',
      path: [syncWindowStartDate ? 'syncWindowEndDate' : 'syncWindowStartDate'],
    });
    return;
  }
  if (syncWindowStartDate > syncWindowEndDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sync window start must be on or before its end',
      path: ['syncWindowStartDate'],
    });
    return;
  }
  if (
    value.startDate < syncWindowStartDate ||
    value.endDate > syncWindowEndDate
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sync window must contain the requested chunk',
      path: ['syncWindowStartDate'],
    });
    return;
  }
  if (
    getInclusiveAdsDateRangeDays(syncWindowStartDate, syncWindowEndDate) >
    ADS_ANALYTICS_MAX_DAYS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Sync window cannot exceed ${ADS_ANALYTICS_MAX_DAYS} days`,
      path: ['syncWindowEndDate'],
    });
  }
}
