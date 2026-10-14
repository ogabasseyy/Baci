import { z } from 'zod';
import { nativeCheckoutSnapshotSchema } from './cart-checkout-snapshot';

const minor = z.number().int().nonnegative();
const identity = z.object({
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  condition: z.enum(['new', 'used', 'open_box', 'refurbished']).optional(),
  options: z.record(z.string(), z.string()).optional(),
});
export const nativeCartSnapshotSchema = z.object({
  cartId: z.uuid(),
  merchantId: z.uuid(),
  state: z.enum(['active', 'checkout', 'completed', 'expired', 'canceled']),
  version: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotalMinor: minor,
  totalMinor: minor,
  estimatedTotals: z.boolean(),
  expiresAt: z.iso.datetime({ offset: true }),
  checkoutSessionId: z.uuid().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        item: identity,
        quantity: z.number().int().min(1).max(10),
        unitPriceMinor: minor,
        lineTotalMinor: minor,
        negotiatedUnitPriceMinor: minor.optional(),
        negotiationStatus: z
          .enum(['pending', 'accepted', 'rejected'])
          .optional(),
        voucherToken: z.string().optional(),
        voucherAwardId: z.string().optional(),
        hasAssurance: z.boolean().optional(),
        assuranceRate: z.number().nonnegative().optional(),
      })
    )
    .max(20),
});
export const nativeCartReplySchema = z.object({
  snapshot: nativeCheckoutSnapshotSchema.optional(),
  sessionReused: z.boolean().optional(),
  cart: nativeCartSnapshotSchema.nullable().optional(),
  proof: z
    .string()
    .regex(/^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .max(8192)
    .optional(),
  replayed: z.boolean().optional(),
  merchant: z.object({ id: z.uuid(), slug: z.string() }).optional(),
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        lineId: z.string().optional(),
      })
    )
    .optional(),
  code: z.string().max(64).optional(),
  error: z.string().optional(),
  choice: z.enum(['connect', 'merge', 'keep_existing']).optional(),
  linkedUserId: z.uuid().optional(),
  operationId: z.string().min(1).max(128).optional(),
});
