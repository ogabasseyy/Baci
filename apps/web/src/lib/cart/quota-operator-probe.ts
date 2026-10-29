import { cartQuotaCounterSchema } from '@/schemas/cart-quota-counter';

type ProbeResult = {
  data: unknown;
  error: { message: string } | null;
};

/** Runs only against a fresh synthetic key supplied by the operator. */
export async function verifyQuotaOperatorProbe(
  call: (name: string) => Promise<ProbeResult>
): Promise<void> {
  try {
    const first = await call('increment_commerce_cart_quota');
    const second = await call('increment_commerce_cart_quota');
    const firstCounter = cartQuotaCounterSchema.parse(first.data);
    const secondCounter = cartQuotaCounterSchema.parse(second.data);
    if (
      first.error ||
      second.error ||
      firstCounter.count !== 1 ||
      secondCounter.count !== 2 ||
      firstCounter.resetTime !== secondCounter.resetTime
    ) {
      throw new Error('counter mismatch');
    }
    const sibling = await call('__gigl_hook_reload_canary__');
    if (
      !sibling.error?.message.includes(
        'Cart quota request is outside its capability scope'
      )
    ) {
      throw new Error('guard did not deny sibling RPC');
    }
  } catch {
    // The caller must not print provider errors, keys or token material.
    throw new Error('Cart quota probe failed');
  }
}
