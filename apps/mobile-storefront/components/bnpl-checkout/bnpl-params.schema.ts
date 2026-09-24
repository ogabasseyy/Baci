import { z } from 'zod';

const moneyString = (message: string) =>
  z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/, message)
    .optional();

/**
 * Canonical money serialization for BNPL route params: two-decimal
 * normalization collapses float artifacts (230804.63999999998 →
 * "230804.64") that would otherwise fail the moneyString regex and
 * land the shopper on the invalid-parameters screen.
 */
export function toMoneyRouteParam(value: number): string {
  return value.toFixed(2);
}

export const BNPLParamsSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  gateway: z.enum(['credpal', 'credit_direct', 'klump'] as const, {
    message: 'Invalid payment gateway',
  }),
  authorizationUrl: z.string().min(1).optional(),
  amount: moneyString('Amount must be a number'),
  // Canonical order total for completion attribution. `amount` is the
  // residual the provider charges after wallet/savings credit, but revenue
  // is the full order — completions must not understate it.
  orderTotal: moneyString('Order total must be a number'),
  customerEmail: z.email().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  merchantSlug: z.string().optional(),
  reference: z.string().optional(),
  trackingToken: z.string().optional(),
  // Checkout breakdown snapshot: approved completions consume the durable
  // claim immediately, and the success screen cannot enrich it afterwards.
  subtotal: moneyString('Subtotal must be a number'),
  shipping: moneyString('Shipping must be a number'),
  tax: moneyString('Tax must be a number'),
});
