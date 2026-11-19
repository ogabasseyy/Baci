import { z } from 'zod';

const count = z.number().int().nonnegative().safe();

/** Result of the `commerce_cart_publish_health()` RPC: counts only. */
export const cartNoticeHealthSchema = z.object({
  healthy: z.boolean(),
  staleUndelivered: count,
  deadLettered24h: count,
});

export type CartNoticeHealth = z.infer<typeof cartNoticeHealthSchema>;
