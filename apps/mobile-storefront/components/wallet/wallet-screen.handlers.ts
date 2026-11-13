import { router } from 'expo-router';
import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { createLogger } from '@/lib/logger';
import { rollbackObservedCapabilityOnNotReady } from '@/lib/piggyvest-primary-capability';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { trackError, trackEvent } from '@/services/analytics';
import { walletOutcomeNotifier } from './fund/wallet-outcome-notifier';
import {
  fundPrimaryWalletCard,
  NOTHING_TO_RECOVER,
} from './fund-primary-wallet-card';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';
import {
  buildWalletTopUpGatewayParams,
  getWalletCustomerName,
  validateWalletTopUpAmount,
} from './wallet-screen.helpers';

const log = createLogger('Wallet');

interface WalletHandlerCustomer {
  email?: string | null;
  first_name?: string | null;
  id?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

interface WalletHandlerUser {
  email?: string | null;
  id?: string | null;
}

interface FundWalletParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  customer?: WalletHandlerCustomer | null;
  fundAmount: string;
  refetchWalletBalance?: () => Promise<unknown>;
  resetFundPanel: () => void;
  setIsFundPending: (isPending: boolean) => void;
  user?: WalletHandlerUser | null;
  walletReturnTo?: string;
}

// Account creation and points redemption live in their own modules;
// re-exported for existing callers.
export { createWalletFundingAccount } from './create-wallet-funding-account';
export { redeemWalletPoints } from './redeem-wallet-points';

export async function fundWallet({
  activeMerchantId,
  activeMerchantSlug,
  customer,
  fundAmount,
  refetchWalletBalance,
  resetFundPanel,
  setIsFundPending,
  user,
  walletReturnTo,
}: FundWalletParams): Promise<void> {
  const notify = walletOutcomeNotifier(activeMerchantId);
  if (isHostedStagingWalletTopUpBlocked()) {
    notify(
      {
        title: 'Wallet top-up unavailable',
        message:
          'Card wallet top-ups are disabled in this hosted staging preview.',
        tone: 'warning',
      },
      {
        title: 'Wallet top-up unavailable',
        message:
          'Card wallet top-ups are disabled in this hosted staging preview.',
      }
    );
    return;
  }
  // A failed probe blocks with a retry that re-runs funding with these params.
  const rail = await resolveFundWalletRail(activeMerchantId, {
    userId: user?.id ?? undefined,
    walletReturnTo,
    onRetry: () =>
      void fundWallet({
        activeMerchantId,
        activeMerchantSlug,
        customer,
        fundAmount,
        refetchWalletBalance,
        resetFundPanel,
        setIsFundPending,
        user,
        walletReturnTo,
      }),
  });
  if (rail === 'blocked') return;
  if (rail === 'primary') {
    // Recovery before amount validation: a saved (maybe charged) funding is
    // rechecked even with an empty amount; new fundings validate inside.
    try {
      const outcome = await fundPrimaryWalletCard({
        activeMerchantId,
        activeMerchantSlug,
        customer,
        fundAmount,
        refetchWalletBalance,
        resetFundPanel,
        setIsFundPending,
        user,
        walletReturnTo,
      });
      if (outcome !== NOTHING_TO_RECOVER) return;
    } catch (error) {
      // Primary unconfigured on the server: fall through to legacy below.
      if (!rollbackObservedCapabilityOnNotReady(activeMerchantId, error))
        throw error;
    }
  }
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
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
      // Persisted server-side so the wallet-credited push can deep-link the
      // customer back to the interrupted purchase.
      returnTo: walletReturnTo,
    });
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
