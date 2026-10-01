import { describe, expect, it } from 'vitest';
import { clearPaymentLaunch, tryStartPaymentLaunch } from './bnpl-launch-keys';

describe('bnpl-launch-keys single-flight guard', () => {
  it('starts the first launch for an order', () => {
    const ref = { current: null as string | null };

    expect(tryStartPaymentLaunch(ref, 'order-1:credit_direct')).toBe(true);
    expect(ref.current).toBe('order-1:credit_direct');
  });

  it('rejects a duplicate launch for the same key', () => {
    const ref = { current: 'order-1:credit_direct' as string | null };

    expect(tryStartPaymentLaunch(ref, 'order-1:credit_direct')).toBe(false);
    expect(ref.current).toBe('order-1:credit_direct');
  });

  it('allows a new key after clear', () => {
    const ref = { current: 'order-1:credit_direct' as string | null };
    clearPaymentLaunch(ref);

    expect(ref.current).toBeNull();
    expect(tryStartPaymentLaunch(ref, 'order-1:klump')).toBe(true);
  });
});
