import { z } from 'zod';

export const oxygenPurchasedCartLineSchema = z.object({
  cartItemId: z.string().min(1),
  instanceId: z.string().min(1),
  quantity: z.number().int().positive(),
});
export const oxygenCheckoutSnapshotSchema = z.object({
  orderId: z.string().min(1),
  merchantId: z.string().min(1),
  lines: z.array(oxygenPurchasedCartLineSchema),
  checkoutForm: z.string().nullable(),
});
export const oxygenOwnedPendingCheckoutSchema = z.object({
  orderId: z.string().min(1),
  merchantId: z.string().min(1),
  paymentMethod: z.literal('oxygen'),
  checkoutFingerprint: z.string().refine((value) => value.trim().length > 0),
});
