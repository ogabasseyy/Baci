import { expect, it, vi } from 'vitest';
import { getCheckoutPageResumeFallback } from './get-checkout-page-resume-fallback';

it('shows the loading fallback while recovering an empty cart', () => {
  const args = {
    checkoutAttempt: { isLoadingResumedOrder: true } as Parameters<
      typeof getCheckoutPageResumeFallback
    >[0]['checkoutAttempt'],
    cartEmpty: true,
    isHydrated: true,
    requestedOxygenId: 'expected',
    verifiedOxygenOrderId: undefined as string | undefined,
    navigate: vi.fn(),
  };
  expect(getCheckoutPageResumeFallback(args)).not.toBeNull();
  expect(
    getCheckoutPageResumeFallback({
      ...args,
      verifiedOxygenOrderId: 'expected',
    })
  ).toBeNull();
});
