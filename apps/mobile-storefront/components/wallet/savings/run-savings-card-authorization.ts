import { router } from 'expo-router';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { initializeSavingsAuthorization } from '@/lib/customer-savings';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { getErrorMessage } from './start-savings-controller.utils';

const CARD_AUTHORIZATION_AMOUNT = 100;

export async function runSavingsCardAuthorization(
  input: UseStartSavingsSubmitInput,
  isCurrent: () => boolean
): Promise<void> {
  if (!isCurrent()) return;
  try {
    const result = await initializeSavingsAuthorization({
      amount: CARD_AUTHORIZATION_AMOUNT,
      merchantId: input.activeMerchantId,
      merchantSlug: input.activeMerchantSlug,
    });
    if (!isCurrent()) return;
    input.setShowFundingModal(false);
    router.push({
      pathname: '/payment-gateway',
      params: {
        authorizationUrl: result.authorization_url,
        gateway: result.gateway,
        merchantId: input.activeMerchantId,
        merchantSlug: input.activeMerchantSlug,
        paymentKind: 'savings_auth',
        reference: result.reference,
        returnTo: '/wallet/savings/start',
      },
    });
  } catch (error) {
    if (!isCurrent()) return;
    showAppAlert({
      title: 'Unable to add card',
      message: getErrorMessage(
        error,
        'Unable to start Paystack card authorization.'
      ),
      variant: 'error',
    });
  }
}
