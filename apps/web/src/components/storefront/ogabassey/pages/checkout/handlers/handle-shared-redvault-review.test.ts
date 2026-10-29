import { beforeEach, expect, it, vi } from 'vitest';
import { createContext } from '../hooks/checkout-order-submission.test-support';
import { handleSharedRedvaultReview } from './handle-shared-redvault-review';
import { recoverTerminalRedvaultReviewForContext } from './recover-terminal-redvault-review';
import { submitPreparedCheckout } from './submit-prepared-checkout';

vi.mock('./recover-terminal-redvault-review', () => ({
  recoverTerminalRedvaultReviewForContext: vi.fn().mockResolvedValue(false),
}));
vi.mock('./submit-prepared-checkout', () => ({
  submitPreparedCheckout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it.each([
  ['reviewed-cart', 'reviewed-cart', true],
  ['different-cart', 'reviewed-cart', false],
  ['reviewed-cart', undefined, false],
] as const)('continues a reviewed order only for its own active cart (%s)', async (cartId, reviewedCartId, expected) => {
  const context = createContext();
  context.cart.sharedCartEnabled = true;
  context.cart.sharedCartRef = { cartId, version: 1 };
  context.cart.checkoutCart = [
    { id: 'item', quantity: 1, price: 100 } as never,
  ];
  context.payment.session.method = 'uba_redvault';
  context.payment.session.redvault.orderReady = {
    cartId: reviewedCartId,
    checkoutFingerprint: 'same-fingerprint',
  } as never;
  const prepared = {
    kind: 'ready',
    identity: { checkoutFingerprint: 'same-fingerprint' },
  } as never;

  if (!context.merchant) throw new Error('Missing fixture merchant');
  const handled = await handleSharedRedvaultReview(context, context.merchant, prepared);

  expect(handled).toBe(true);
  expect(submitPreparedCheckout).toHaveBeenCalledTimes(expected ? 1 : 0);
  expect(recoverTerminalRedvaultReviewForContext).not.toHaveBeenCalled();
  expect(context.processing.releaseSubmission).toHaveBeenCalledTimes(
    expected ? 0 : 1
  );
});
