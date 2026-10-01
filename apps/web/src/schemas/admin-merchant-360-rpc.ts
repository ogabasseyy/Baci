import { z } from 'zod';

const countSchema = z.number().int().nonnegative();
// Operational ledgers can contain negative anomaly values; preserve them for
// investigation instead of turning the entire snapshot into a parse failure.
const moneySchema = z.number().finite();
// PostgREST serializes timestamptz with the project's configured offset, which
// is not guaranteed to be a trailing `Z`. Validate presence without rejecting
// a valid database timestamp solely for its offset representation.
const nullableDateSchema = z.string().min(1).nullable();

const moneyStatusSummarySchema = z.object({
  failedAmount: moneySchema.nullable(),
  failedCount: countSchema,
  pendingAmount: moneySchema.nullable(),
  pendingCount: countSchema,
});

const currencylessSettlementSummarySchema = z.object({
  currency: z.null(),
  failedAmount: z.null(),
  failedCount: countSchema,
  pendingAmount: z.null(),
  pendingCount: countSchema,
  settledAmount: z.null(),
  settledCount: countSchema,
});

export const adminMerchant360RpcSchema = z.object({
  domain: z.object({
    hasPrimary: z.boolean(),
    primaryDomain: z.string().nullable(),
    sslStatus: z.string().nullable(),
    status: z.string().nullable(),
    verifiedAt: nullableDateSchema,
  }),
  generatedAt: z.string().min(1),
  moneyCurrency: z.string().regex(/^[A-Z]{3}$/),
  incidents: z.object({
    domainEventFailures30d: countSchema,
    eventDeliveryDeadLetters30d: countSchema,
    shipmentFailures30d: countSchema,
  }),
  merchant: z.object({
    businessName: z.string().nullable(),
    createdAt: nullableDateSchema,
    id: z.string().uuid(),
    isPublished: z.boolean().nullable(),
    planTier: z.string().nullable(),
    signupSource: z.string().nullable(),
    slug: z.string().nullable(),
    updatedAt: nullableDateSchema,
  }),
  payouts: moneyStatusSummarySchema.extend({
    completedAmount: moneySchema.nullable(),
    completedCount: countSchema,
  }),
  readiness: z.object({
    hasStorefrontSlug: z.boolean(),
    isPublished: z.boolean(),
    paymentConfigured: z.boolean(),
    shippingConfigured: z.boolean(),
    storefrontReady: z.boolean(),
  }),
  recentAuditEvents: z.array(
    z.object({
      action: z.string(),
      changedFields: z.array(z.string()),
      occurredAt: z.string().min(1),
      resourceType: z.string(),
    })
  ),
  sales: z.object({
    displayCurrencyPaidOrders: countSchema,
    excludedNonDisplayCurrencyPaidOrders: countSchema,
    lastPaidAt: nullableDateSchema,
    paidGmv: moneySchema,
    paidOrders: countSchema,
  }),
  staffAccess: z.array(
    z.object({
      role: z.string(),
      status: z.string(),
      users: countSchema,
    })
  ),
  settlements: currencylessSettlementSummarySchema,
  summary: z.object({
    activeAdminAppInstallations: countSchema,
    activeStorefrontAppInstallations: countSchema,
    customerUsers: countSchema,
    staffUsers: countSchema,
    unmatchedAppUsers: countSchema,
    webUsers: countSchema,
  }),
});
