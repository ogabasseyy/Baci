import 'server-only';
import { cartQuotaCounterSchema } from '@/schemas/cart-quota-counter';
import { createCartQuotaScopedClient } from './scoped-client';

/** One counter per token; no cart contents or broad server privileges. */
export async function incrementSupabaseQuotaCounter(
  key: string,
  windowMs: number
): Promise<{ count: number; resetTime: number; degraded: false }> {
  const client = createCartQuotaScopedClient(key, windowMs);
  const { data, error } = await client
    .rpc('increment_commerce_cart_quota')
    .abortSignal(AbortSignal.timeout(1500));
  if (error) throw new Error('Cart quota counter unavailable');
  const result = cartQuotaCounterSchema.parse(data);
  const now = Date.now();
  if (result.resetTime < now - 5000 || result.resetTime > now + windowMs + 5000)
    throw new Error('Invalid cart quota expiry');
  return { ...result, degraded: false };
}
