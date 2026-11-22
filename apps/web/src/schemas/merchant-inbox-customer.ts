import { z } from 'zod';

/** What a conversation row shows about a verified signed-in customer. */
export const merchantInboxCustomerBadgeSchema = z.object({
  orderCount: z.number().int().nonnegative(),
  totalSpent: z.number().nonnegative(),
});
export type MerchantInboxCustomerBadge = z.infer<
  typeof merchantInboxCustomerBadgeSchema
>;

export const merchantInboxCustomerOrderSchema = z.object({
  orderNumber: z.string().max(60),
  total: z.number(),
  paymentStatus: z.string().max(40),
  shippingStatus: z.string().max(40),
  createdAt: z.string().nullable(),
});

/** The card shown above a linked conversation. No email, phone or address. */
export const merchantInboxCustomerProfileSchema = z.object({
  name: z.string().max(120),
  memberSince: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  totalSpent: z.number().nonnegative(),
  loyaltyPoints: z.number().int().nonnegative(),
  recentOrders: z.array(merchantInboxCustomerOrderSchema).max(5),
});
export type MerchantInboxCustomerProfile = z.infer<
  typeof merchantInboxCustomerProfileSchema
>;
