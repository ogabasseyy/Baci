import { z } from 'zod';
import {
  ADS_ANALYTICS_MAX_DAYS,
  ADS_SYNC_MAX_DAYS,
  getInclusiveAdsDateRangeDays,
} from '@/lib/analytics/ads-sync-limits';

export const MAX_META_ADS_SYNC_DAYS = ADS_SYNC_MAX_DAYS.meta_ads;

export const metaAdsOAuthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
});

const metaAccountId = z
  .string()
  .trim()
  .regex(/^act_\d+$/, 'Invalid Meta ad account id');

export const metaAdsAccountSelectionSchema = z.object({
  accountId: metaAccountId,
});

export const metaAdsSpendQuerySchema = z
  .object({
    accountId: metaAccountId.optional(),
    endDate: z.string().date().optional(),
    startDate: z.string().date().optional(),
  })
  .superRefine((value, context) => {
    validateDateOrder(value, context);
    if (
      value.startDate &&
      value.endDate &&
      value.startDate <= value.endDate &&
      getInclusiveAdsDateRangeDays(value.startDate, value.endDate) >
        MAX_META_ADS_SYNC_DAYS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Spend range cannot exceed ${MAX_META_ADS_SYNC_DAYS} days`,
        path: ['endDate'],
      });
    }
  });

export const metaAdsSyncRequestSchema = z
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
    validateDateOrder(value, context);
    if (value.startDate > value.endDate) return;
    const days = getInclusiveAdsDateRangeDays(value.startDate, value.endDate);
    if (days > MAX_META_ADS_SYNC_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sync range cannot exceed ${MAX_META_ADS_SYNC_DAYS} days`,
        path: ['endDate'],
      });
    }
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

function validateDateOrder(
  value: { endDate?: string; startDate?: string },
  context: z.RefinementCtx
): void {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startDate must be on or before endDate',
      path: ['startDate'],
    });
  }
}
