import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { toast } from '@/hooks/use-toast';
import { checkOxygenStorefrontAvailability } from '../check-oxygen-storefront-availability';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

/**
 * Guards Oxygen order submission: prompts guests to sign in via CheckoutAuthModal
 * and blocks incompatible carts (non-NGN, wallet credit, or unavailable store).
 * Returns true if submission was handled/blocked and the caller should return.
 */
export async function guardOxygenOrderSubmission(
  context: CheckoutOrderSubmissionContext,
  merchantId: string
): Promise<boolean> {
  if (context.payment.session.method !== 'oxygen') return false;
  if (!(await context.account.waitForResolvedCustomerAuth())) {
    context.account.openAuthModal?.();
    toast({
      title: 'Sign in to continue',
      description:
        'Please sign in or create an account to continue with Oxygen.',
    });
    context.processing.releaseSubmission();
    return true;
  }
  if (
    (!isOxygenStorefrontStagingEnabled() &&
      !(await checkOxygenStorefrontAvailability(merchantId))) ||
    context.payment.currencyCode !== 'NGN' ||
    context.payment.session.wallet.amountUsed > 0
  ) {
    toast({
      title: 'Payment plan unavailable',
      description:
        'Oxygen is unavailable for this cart. Wallet credit cannot be combined with this payment plan.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }
  return false;
}
