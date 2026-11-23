import { z } from 'zod';

/** What a conversation row shows about a verified signed-in customer. */
export const merchantInboxCustomerBadgeSchema = z.object({
  orderCount: z.number().int().nonnegative(),
  totalSpent: z.number().nonnegative(),
  /** True when the caller may not see order data: the counts above are then 0. */
  ordersHidden: z.boolean().optional(),
});
export type MerchantInboxCustomerBadge = z.infer<
  typeof merchantInboxCustomerBadgeSchema
>;

export const merchantInboxCustomerOrderSchema = z.object({
  orderNumber: z.string().max(60),
  total: z.number(),
  /** ISO 4217 code the order was placed in. */
  currency: z.string().length(3),
  paymentStatus: z.string().max(40),
  shippingStatus: z.string().max(40),
  createdAt: z.string().nullable(),
});

/** The card shown above a linked conversation. No email, phone or address. */
export const merchantInboxCustomerProfileSchema = z.object({
  name: z.string().max(120),
  /** The store's currency, for the spend total. */
  currency: z.string().length(3),
  memberSince: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  totalSpent: z.number().nonnegative(),
  loyaltyPoints: z.number().int().nonnegative(),
  /** True when the caller may not see order data: counts and spend are then 0. */
  ordersHidden: z.boolean().optional(),
  recentOrders: z.array(merchantInboxCustomerOrderSchema).max(5),
});
export type MerchantInboxCustomerProfile = z.infer<
  typeof merchantInboxCustomerProfileSchema
>;
