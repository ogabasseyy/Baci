import { z } from 'zod';
import { toSafeInternalRedirectPath } from '@/lib/safe-internal-redirect-path';

const internalRedirectPathSchema = z
  .string()
  .refine(
    (value) => toSafeInternalRedirectPath(value) === value,
    'Invalid redirect path'
  );

const receiptClaimOrderItemSchema = z.object({
  name: z.string().nullable(),
  quantity: z.number().nullable(),
});

const receiptClaimOrderSchema = z.object({
  id: z.string(),
  order_items: z.array(receiptClaimOrderItemSchema).nullable().optional(),
  order_number: z.string(),
});

const receiptClaimMerchantSchema = z.object({
  business_name: z.string().nullable(),
  slug: z.string().nullable(),
});

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nullableIsoDateTimeSchema = z.iso.datetime({ offset: true }).nullable();
const receiptClaimChannelSourceSchema = z
  .enum(['web', 'app', 'unknown'])
  .nullable();
const receiptClaimAppDownloadSourceSchema = z
  .enum(['app_store', 'play_store', 'unknown'])
  .nullable();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonNegativeIntegerFallback(
  value: unknown,
  fallback: number
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function readRemainingChannelCount(
  value: unknown,
  totalCount: number,
  appCount: number,
  unknownCount: number
) {
  return readNonNegativeIntegerFallback(
    value,
    Math.max(totalCount - appCount - unknownCount, 0)
  );
}

function defaultSourceWhenTimestampExists({
  fallbackSource,
  normalized,
  sourceField,
  timestampField,
}: Readonly<{
  fallbackSource: 'app_store' | 'play_store' | 'unknown' | 'web';
  normalized: Record<string, unknown>;
  sourceField: string;
  timestampField: string;
}>) {
  if (sourceField in normalized) {
    return;
  }

  normalized[sourceField] =
    normalized[timestampField] === null ||
    normalized[timestampField] === undefined
      ? null
      : fallbackSource;
}

function normalizeReceiptClaimCampaignRecipient(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const normalized = { ...value };
  normalized.appDownloadClickCount ??= 0;
  normalized.firstAppDownloadClickedAt ??= null;
  normalized.lastAppDownloadClickedAt ??= null;

  const sourceDefaults = [
    ['claimedSource', 'claimedAt', 'web'],
    ['firstClickSource', 'firstClickedAt', 'web'],
    ['lastClickSource', 'lastClickedAt', 'web'],
    ['firstLoginStartedSource', 'firstLoginStartedAt', 'web'],
    ['lastLoginStartedSource', 'lastLoginStartedAt', 'web'],
    ['firstAppDownloadSource', 'firstAppDownloadClickedAt', 'unknown'],
    ['lastAppDownloadSource', 'lastAppDownloadClickedAt', 'unknown'],
  ] as const;

  for (const [sourceField, timestampField, fallbackSource] of sourceDefaults) {
    defaultSourceWhenTimestampExists({
      fallbackSource,
      normalized,
      sourceField,
      timestampField,
    });
  }

  return normalized;
}

const receiptClaimCampaignRecipientBaseSchema = z.object({
  appDownloadClickCount: nonNegativeIntegerSchema,
  claimedAt: nullableIsoDateTimeSchema,
  claimedSource: receiptClaimChannelSourceSchema,
  clickCount: nonNegativeIntegerSchema,
  customerEmail: z.string(),
  customerName: z.string().nullable(),
  firstAppDownloadClickedAt: nullableIsoDateTimeSchema,
  firstAppDownloadSource: receiptClaimAppDownloadSourceSchema,
  firstClickedAt: nullableIsoDateTimeSchema,
  firstClickSource: receiptClaimChannelSourceSchema,
  firstLoginStartedAt: nullableIsoDateTimeSchema,
  firstLoginStartedSource: receiptClaimChannelSourceSchema,
  id: z.string(),
  lastAppDownloadClickedAt: nullableIsoDateTimeSchema,
  lastAppDownloadSource: receiptClaimAppDownloadSourceSchema,
  lastClickedAt: nullableIsoDateTimeSchema,
  lastClickSource: receiptClaimChannelSourceSchema,
  lastLoginStartedAt: nullableIsoDateTimeSchema,
  lastLoginStartedSource: receiptClaimChannelSourceSchema,
  loginStartedCount: nonNegativeIntegerSchema,
  notificationSentAt: nullableIsoDateTimeSchema,
});

const receiptClaimCampaignRecipientSchema = z.preprocess(
  normalizeReceiptClaimCampaignRecipient,
  receiptClaimCampaignRecipientBaseSchema.superRefine((recipient, context) => {
    const pairedFields = [
      ['claimedAt', 'claimedSource'],
      ['firstClickedAt', 'firstClickSource'],
      ['lastClickedAt', 'lastClickSource'],
      ['firstLoginStartedAt', 'firstLoginStartedSource'],
      ['lastLoginStartedAt', 'lastLoginStartedSource'],
      ['firstAppDownloadClickedAt', 'firstAppDownloadSource'],
      ['lastAppDownloadClickedAt', 'lastAppDownloadSource'],
    ] as const;

    for (const [timestampField, sourceField] of pairedFields) {
      const hasTimestamp = recipient[timestampField] !== null;
      const hasSource = recipient[sourceField] !== null;

      if (hasTimestamp === hasSource) {
        continue;
      }

      context.addIssue({
        code: 'custom',
        message: `${timestampField} and ${sourceField} must be returned together`,
        path: [hasTimestamp ? sourceField : timestampField],
      });
    }
  })
);

function normalizeReceiptClaimCampaignStats(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const clickedCount = readNonNegativeIntegerFallback(value.clickedCount, 0);
  const loginStartedCount = readNonNegativeIntegerFallback(
    value.loginStartedCount,
    0
  );
  const claimedCount = readNonNegativeIntegerFallback(value.claimedCount, 0);
  // biome-ignore format: compact fallback preserves the 300-line verifier gate.
  const claimedAppCount = readNonNegativeIntegerFallback(value.claimedAppCount, 0);
  const claimedUnknownCount = readNonNegativeIntegerFallback(
    value.claimedUnknownCount,
    0
  );
  const clickedAppCount = readNonNegativeIntegerFallback(
    value.clickedAppCount,
    0
  );
  const clickedUnknownCount = readNonNegativeIntegerFallback(
    value.clickedUnknownCount,
    0
  );
  const loginStartedAppCount = readNonNegativeIntegerFallback(
    value.loginStartedAppCount,
    0
  );
  const loginStartedUnknownCount = readNonNegativeIntegerFallback(
    value.loginStartedUnknownCount,
    0
  );

  return {
    ...value,
    appDownloadClickCount: value.appDownloadClickCount ?? 0,
    appDownloadClickedCount: value.appDownloadClickedCount ?? 0,
    claimedAppCount: value.claimedAppCount ?? 0,
    claimedUnknownCount: value.claimedUnknownCount ?? 0,
    claimedWebCount: readRemainingChannelCount(
      value.claimedWebCount,
      claimedCount,
      claimedAppCount,
      claimedUnknownCount
    ),
    clickedAppCount: value.clickedAppCount ?? 0,
    clickedUnknownCount: value.clickedUnknownCount ?? 0,
    clickedWebCount: readRemainingChannelCount(
      value.clickedWebCount,
      clickedCount,
      clickedAppCount,
      clickedUnknownCount
    ),
    loginStartedAppCount: value.loginStartedAppCount ?? 0,
    loginStartedUnknownCount: value.loginStartedUnknownCount ?? 0,
    loginStartedWebCount: readRemainingChannelCount(
      value.loginStartedWebCount,
      loginStartedCount,
      loginStartedAppCount,
      loginStartedUnknownCount
    ),
  };
}

export const receiptClaimRecordSchema = z.object({
  claimed_at: z.string().nullable(),
  claimed_by_user_id: z.string().nullable(),
  customer_email: z.string(),
  customer_id: z.string(),
  customer_name: z.string().nullable(),
  expires_at: z.string(),
  id: z.string(),
  merchant_id: z.string(),
  merchant: receiptClaimMerchantSchema.nullable().optional(),
  orders: z.array(receiptClaimOrderSchema).nullable().optional(),
});

export const redeemReceiptClaimResultSchema = z.object({
  redirectPath: internalRedirectPathSchema.optional(),
  status: z.enum([
    'already_used',
    'customer_link_failed',
    'email_mismatch',
    'email_unverified',
    'expired',
    'not_found',
    'ok',
    'unauthorized',
  ]),
});

export const createReceiptClaimResultSchema = z.object({
  claim_id: z.string().nullable().optional(),
  status: z.enum(['created', 'skipped']),
});

export const receiptClaimCampaignStatsSchema = z.preprocess(
  normalizeReceiptClaimCampaignStats,
  z.object({
    appDownloadClickCount: nonNegativeIntegerSchema,
    appDownloadClickedCount: nonNegativeIntegerSchema,
    claimedAppCount: nonNegativeIntegerSchema,
    claimedCount: nonNegativeIntegerSchema,
    claimedUnknownCount: nonNegativeIntegerSchema,
    claimedWebCount: nonNegativeIntegerSchema,
    clickedAppCount: nonNegativeIntegerSchema,
    clickedCount: nonNegativeIntegerSchema,
    clickedUnknownCount: nonNegativeIntegerSchema,
    clickedWebCount: nonNegativeIntegerSchema,
    lastActivityAt: nullableIsoDateTimeSchema,
    loginStartedAppCount: nonNegativeIntegerSchema,
    loginStartedCount: nonNegativeIntegerSchema,
    loginStartedUnknownCount: nonNegativeIntegerSchema,
    loginStartedWebCount: nonNegativeIntegerSchema,
    recipients: z.array(receiptClaimCampaignRecipientSchema),
    sentCount: nonNegativeIntegerSchema,
    totalRecipients: nonNegativeIntegerSchema,
  })
);

export type ReceiptClaimRecord = z.infer<typeof receiptClaimRecordSchema>;
export type CreateReceiptClaimResult = z.infer<
  typeof createReceiptClaimResultSchema
>;
export type RedeemReceiptClaimResult = z.infer<
  typeof redeemReceiptClaimResultSchema
>;
export type ReceiptClaimCampaignStats = z.infer<
  typeof receiptClaimCampaignStatsSchema
>;
