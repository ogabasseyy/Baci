import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { toast } from '@/hooks/use-toast';
import { checkOxygenStorefrontAvailability } from '../check-oxygen-storefront-availability';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

type PaymentSessionWithOptionalSavings =
  CheckoutOrderSubmissionContext['payment']['session'] & {
    savings?: { amountUsed?: number };
  };

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
  const session = context.payment.session as PaymentSessionWithOptionalSavings;
  const walletRemaining =
    typeof session.wallet.remainingAmount === 'number' &&
    Number.isFinite(session.wallet.remainingAmount)
      ? Math.min(
          session.wallet.remainingAmount,
          session.total - session.wallet.amountUsed
        )
      : session.total - session.wallet.amountUsed;
  const savingsAmountUsed = Math.max(session.savings?.amountUsed ?? 0, 0);
  if (walletRemaining - savingsAmountUsed <= 0) {
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
