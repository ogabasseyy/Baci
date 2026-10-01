import { z } from 'zod';

const finiteNonnegativeNumericSchema = z.union([
  z.number().finite().nonnegative(),
  z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .refine((value) => Number.isFinite(Number(value))),
]);

export const adminMerchantHealthRowSchema = z.object({
  active_days: z.number().int().nonnegative(),
  business_name: z.string().max(200).nullable(),
  email: z.string().email().max(254).nullable(),
  health_status: z.enum(['healthy', 'at_risk', 'churned', 'new']),
  joined_at: z.string().datetime({ offset: true }),
  excluded_non_ngn_or_unknown_paid_orders: z.number().int().nonnegative(),
  last_order_date: z.iso.date().nullable(),
  merchant_id: z.string().uuid(),
  storefront_slug: z.string().max(255).nullable(),
  total_gmv: finiteNonnegativeNumericSchema,
  total_orders: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative().default(0),
});

export const adminMerchantHealthRowsSchema = z.array(
  adminMerchantHealthRowSchema
);
