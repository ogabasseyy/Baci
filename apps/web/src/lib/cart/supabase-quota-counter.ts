import 'server-only';
import { cartQuotaCounterSchema } from '@/schemas/cart-quota-counter';
import { createCartQuotaScopedClient } from './scoped-client';
import { SupabaseQuotaCounterError } from './supabase-quota-error';

/** One counter per token; no cart contents or broad server privileges. */
export async function incrementSupabaseQuotaCounter(
  key: string,
  windowMs: number,
  timeoutMs = 1500
): Promise<{ count: number; resetTime: number; degraded: false }> {
  let client: ReturnType<typeof createCartQuotaScopedClient>;
  try {
    client = createCartQuotaScopedClient(key, windowMs);
  } catch {
    throw new SupabaseQuotaCounterError('configuration');
  }

  const signal = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
  let reply: Awaited<ReturnType<ReturnType<typeof client.rpc>['abortSignal']>>;
  try {
    reply = await client
      .rpc('increment_commerce_cart_quota')
      .abortSignal(signal);
  } catch (error) {
    const timeout =
      signal.aborted ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'TimeoutError');
    throw new SupabaseQuotaCounterError(timeout ? 'timeout' : 'rpc_error');
  }
  if (reply.error) {
    throw new SupabaseQuotaCounterError(
      signal.aborted ? 'timeout' : 'rpc_error'
    );
  }
  const parsed = cartQuotaCounterSchema.safeParse(reply.data);
  if (!parsed.success) throw new SupabaseQuotaCounterError('invalid_response');
  const now = Date.now();
  if (
    parsed.data.resetTime < now - 5000 ||
    parsed.data.resetTime > now + windowMs + 5000
  ) {
    throw new SupabaseQuotaCounterError('invalid_expiry');
  }
  return { ...parsed.data, degraded: false };
}
