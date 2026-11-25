import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { toast } from '@/hooks/use-toast';
import { checkOxygenStorefrontAvailability } from '../check-oxygen-storefront-availability';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

/**
 * Guards Oxygen order submission: prompts guests to sign in via CheckoutAuthModal
 * and blocks incompatible carts (non-NGN or unavailable store).
 * Returns true if submission was handled/blocked and the caller should return.
 */
export async function guardOxygenOrderSubmission(
  context: CheckoutOrderSubmissionContext,
  merchantId: string
): Promise<boolean> {
  if (context.payment.session.method !== 'oxygen') return false;
  if (
    context.payment.session.total - context.payment.session.wallet.amountUsed <=
    0
  ) {
    return false;
  }
  if (!(await context.account.waitForResolvedCustomerAuth())) {
    if (context.account.openAuthModal) {
      context.account.openAuthModal();
    } else {
      context.navigation.pushSuccessRoute(
        context.navigation.getHref('/account/login')
      );
    }
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
    context.payment.currencyCode !== 'NGN'
  ) {
    toast({
      title: 'Payment plan unavailable',
      description: 'Oxygen is currently unavailable for this order.',
      variant: 'destructive',
    });
    context.processing.releaseSubmission();
    return true;
  }
  return false;
}
