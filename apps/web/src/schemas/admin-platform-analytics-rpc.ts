import { z } from 'zod';

const countSchema = z.number().int().nonnegative();
const metricSchema = z.number().finite();
const moneySchema = metricSchema.nonnegative();
const shareSchema = metricSchema.min(0).max(100);

const statusBreakdownSchema = z.object({
  amount: moneySchema,
  label: z.string(),
  orders: countSchema,
  shareOfAmount: shareSchema,
  shareOfOrders: shareSchema,
  status: z.string(),
});

export const adminPlatformAnalyticsRpcSchema = z.object({
  businessTypeCounts: z.array(
    z.object({
      businessType: z.string().nullable(),
      merchants: countSchema,
    })
  ),
  dailyGmv: z.array(
    z.object({
      date: z.string(),
      gmv: moneySchema,
      merchants: countSchema,
      orders: countSchema,
    })
  ),
  generatedAt: z.string(),
  growth: z.object({
    gmvGrowthRate: metricSchema,
    merchantGrowthRate: metricSchema,
    newMerchantsThisMonth: countSchema,
  }),
  merchantActivation: z.array(
    z.object({
      completionRate: metricSchema,
      description: z.string(),
      key: z.string(),
      label: z.string(),
      merchants: countSchema,
    })
  ),
  merchantHealth: z.object({
    atRisk: countSchema,
    churned: countSchema,
    healthy: countSchema,
    new: countSchema,
  }),
  paymentMethods: z.array(
    z.object({
      amount: moneySchema,
      label: z.string(),
      method: z.string(),
      orders: countSchema,
      shareOfPaidAmount: shareSchema,
      shareOfPaidOrders: shareSchema,
    })
  ),
  paymentStatuses: z.array(statusBreakdownSchema),
  salesByChannel: z.array(
    z.object({
      channel: z.string(),
      gmv: moneySchema,
      orders: countSchema,
      shareOfGmv: shareSchema,
      shareOfOrders: shareSchema,
    })
  ),
  shippingStatuses: z.array(statusBreakdownSchema),
  signupSources: z.array(
    z.object({
      merchants: countSchema,
      shareOfMerchants: shareSchema,
      source: z.enum(['web', 'ios', 'android']),
    })
  ),
  summary: z.object({
    activeMerchantChange: metricSchema,
    activeMerchants: countSchema,
    aovChange: metricSchema,
    avgGmvPerMerchant: moneySchema,
    avgOrderValue: moneySchema,
    gmvChange: metricSchema,
    grossGmv: moneySchema,
    grossOrders: countSchema,
    excludedNonNgnOrUnknownGrossOrders: countSchema,
    excludedNonNgnOrUnknownPaidOrders: countSchema,
    recordedMerchantNet: moneySchema.nullable(),
    orderChange: metricSchema,
    recordedPlatformFees: moneySchema.nullable(),
    recordedProcessorFees: moneySchema.nullable(),
    reportingCurrency: z.literal('NGN'),
    sellingMerchants: countSchema,
    totalGmv: moneySchema,
    totalMerchants: countSchema,
    totalOrders: countSchema,
  }),
  topMerchants: z.array(
    z.object({
      gmv: moneySchema,
      id: z.string().uuid(),
      name: z.string(),
      orders: countSchema,
    })
  ),
});
