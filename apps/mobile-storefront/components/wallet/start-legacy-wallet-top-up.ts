import { router } from 'expo-router';
import { createLogger } from '@/lib/logger';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { trackError, trackEvent } from '@/services/analytics';
import type { walletOutcomeNotifier } from './fund/wallet-outcome-notifier';
import { isSameSignedInUser } from './is-same-signed-in-user';
import {
  buildWalletTopUpGatewayParams,
  getWalletCustomerName,
  validateWalletTopUpAmount,
} from './wallet-screen.helpers';

const log = createLogger('Wallet');

interface StartLegacyWalletTopUpParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  customer?: {
    email?: string | null;
    first_name?: string | null;
    id?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
  fundAmount: string;
  resetFundPanel: () => void;
  setIsFundPending: (isPending: boolean) => void;
  user?: { email?: string | null; id?: string | null } | null;
  walletReturnTo?: string;
  /** In-sheet notice for the PiggyVest store, today's alert elsewhere. */
  notify: ReturnType<typeof walletOutcomeNotifier>;
}

/**
 * Starts a legacy (store credit) card top-up and opens its checkout. The
 * account that started it is checked again once the checkout is created
 * (Codex): a switch while the request was in flight must never show the
 * new account another account's checkout. Outcomes use the in-sheet notice
 * at the PiggyVest store (owner: no alerts on fund screens) and today's
 * alert elsewhere.
 */
export async function startLegacyWalletTopUp({
  activeMerchantId,
  activeMerchantSlug,
  customer,
  fundAmount,
  resetFundPanel,
  setIsFundPending,
  user,
  walletReturnTo,
  notify,
}: StartLegacyWalletTopUpParams): Promise<void> {
  const amount = Number(fundAmount);
  const amountValidationError = validateWalletTopUpAmount(amount);
  if (amountValidationError) {
    notify(
      {
        title: 'Check the amount',
        message: amountValidationError,
        tone: 'warning',
      },
      { title: 'Invalid Amount', message: amountValidationError }
    );
    return;
  }
  setIsFundPending(true);
  try {
    const customerName = getWalletCustomerName(customer, user);
    const result = await initializeWalletTopUp({
      amount,
      customerName,
      customerPhone: customer?.phone,
      expectedUserId: user?.id ?? undefined,
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
      // Persisted so the wallet-credited push deep-links back to the purchase.
      returnTo: walletReturnTo,
    });
    // Checked again after the request (Codex): never open this account's
    // checkout for an account that signed in while it was being created.
    if (user?.id && !isSameSignedInUser(user.id)) {
      const message =
        'You switched accounts. Start the top-up again from this account.';
      notify(
        { title: 'Signed-in account changed', message, tone: 'warning' },
        { title: 'Signed-in account changed', message }
      );
      return;
    }
    trackEvent('wallet_top_up_started', {
      amount,
      customer_id: customer?.id,
      gateway: result.gateway,
      merchant_id: activeMerchantId,
      merchant_slug: activeMerchantSlug,
    });
    resetFundPanel();
    router.push({
      pathname: '/payment-gateway',
      params: buildWalletTopUpGatewayParams({
        activeMerchantId,
        activeMerchantSlug,
        amount,
        result,
        userId: user?.id,
        walletReturnTo,
      }),
    });
  } catch (error) {
    log.error('Wallet top-up initialization error:', error);
    trackError(
      'wallet_top_up_failed',
      error instanceof Error ? error.message : 'Unknown error',
      { amount, customer_id: customer?.id }
    );
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to start wallet top-up. Please try again.';
    notify(
      { title: 'Top-up didn’t start', message, tone: 'warning' },
      { title: 'Top-up Failed', message }
    );
  } finally {
    setIsFundPending(false);
  }
}
