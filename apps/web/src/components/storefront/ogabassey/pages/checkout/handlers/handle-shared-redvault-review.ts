import { toast } from '@/hooks/use-toast';
import { checkoutFingerprintsMatch } from '../checkout-fingerprints-match';
import type { CheckoutOrderSubmissionContext } from '../hooks/checkout-order-submission-types';
import type { PrepareCheckoutOrderSubmissionResult } from '../prepare-checkout-order-submission';
import { redvaultTerminalFingerprintMatches } from '../redvault-terminal-fingerprint';
import { recoverTerminalRedvaultReviewForContext } from './recover-terminal-redvault-review';
import { submitPreparedCheckout } from './submit-prepared-checkout';

/** Continue or release an existing reviewed shared-cart order before a fresh submit. */
export async function handleSharedRedvaultReview(
  context: CheckoutOrderSubmissionContext,
  merchant: NonNullable<CheckoutOrderSubmissionContext['merchant']>,
  prepared: Extract<PrepareCheckoutOrderSubmissionResult, { kind: 'ready' }>
): Promise<boolean> {
  const { cart, payment } = context;
  const ready = payment.session.redvault.orderReady;
  if (
    ready &&
    cart.sharedCartRef &&
    ready.cartId !== cart.sharedCartRef.cartId
  ) {
    toast({
      title: 'Previous UBA checkout still open',
      description:
        'Return to the previous checkout to finish or cancel it before starting another.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }
  const terminalMatches = Boolean(
    ready &&
      cart.sharedCartEnabled &&
      !cart.sharedCartRef &&
      cart.checkoutCart.length === 0 &&
      redvaultTerminalFingerprintMatches(
        ready.checkoutFingerprint,
        prepared.identity.checkoutFingerprint
      )
  );
  if (
    (cart.sharedCartEnabled || cart.sharedCartRef) &&
    payment.session.method === 'uba_redvault' &&
    ready &&
    (terminalMatches ||
      checkoutFingerprintsMatch(
        ready.checkoutFingerprint,
        prepared.identity.checkoutFingerprint
      ))
  ) {
    await submitPreparedCheckout(
      { ...context, merchant },
      terminalMatches
        ? {
            ...prepared,
            identity: {
              ...prepared.identity,
              checkoutFingerprint: ready.checkoutFingerprint,
            },
          }
        : prepared,
      { redvaultPreparedOnly: true }
    );
    return true;
  }
  return recoverTerminalRedvaultReviewForContext(
    context,
    merchant.id,
    prepared.identity.checkoutFingerprint
  );
}
