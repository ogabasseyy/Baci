import { router } from 'expo-router';
import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { createLogger } from '@/lib/logger';
import { rollbackObservedCapabilityOnNotReady } from '@/lib/piggyvest-primary-capability';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { trackError, trackEvent } from '@/services/analytics';
import { fundPrimaryWalletCard } from './fund-primary-wallet-card';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';
import { savingsNotifier } from './savings/savings-notifier';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';
import {
  buildWalletTopUpGatewayParams,
  getWalletCustomerName,
  resolveCreateFundingAccountOutcome,
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

type CreateFundingAccount = Parameters<
  typeof resolveCreateFundingAccountOutcome
>[0];
interface WalletFundingAccountHandlerParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  createFundingAccount: CreateFundingAccount;
  customerId?: string | null;
  customerPhone: string;
  isPaymentSettingsError: boolean;
  isPaymentSettingsPending: boolean;
  // Invoked when the server rejects with CUSTOMER_PHONE_REQUIRED so the caller
  // can show the phone prompt instead of a dead-end message.
  onPhoneRequired?: () => void;
  walletDvaEnabled: boolean;
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

// Redeeming points lives in its own module; re-exported for existing callers.
export { redeemWalletPoints } from './redeem-wallet-points';

export async function createWalletFundingAccount({
  activeMerchantId,
  activeMerchantSlug,
  createFundingAccount,
  customerId,
  customerPhone,
  isPaymentSettingsError,
  isPaymentSettingsPending,
  onPhoneRequired,
  walletDvaEnabled,
}: WalletFundingAccountHandlerParams): Promise<boolean> {
  // Every outcome below is the inline wallet notice, never an iOS alert.
  const notify = savingsNotifier();
  if (isPaymentSettingsPending) {
    notify(
      'Account number unavailable',
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_CHECKING,
      'info'
    );
    return false;
  }

  if (isPaymentSettingsError) {
    notify(
      'Account number unavailable',
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_ERROR,
      'warning'
    );
    return false;
  }

  if (!walletDvaEnabled) {
    notify(
      'Account number unavailable',
      WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED,
      'warning'
    );
    return false;
  }

  if (!customerPhone) {
    notify(
      'Phone number required',
      WALLET_FUNDING_ACCOUNT_MESSAGES.PHONE_REQUIRED,
      'warning'
    );
    return false;
  }

  const outcome =
    await resolveCreateFundingAccountOutcome(createFundingAccount);
  if (outcome.status === 'phone-required') {
    onPhoneRequired?.();
    return false;
  }
  if (outcome.status === 'error') {
    trackError(
      'wallet_funding_account_create_failed',
      outcome.telemetryMessage,
      {
        customer_id: customerId,
        merchant_id: activeMerchantId,
        merchant_slug: activeMerchantSlug,
      }
    );
    notify('Unable to create account number', outcome.alertMessage, 'warning');
    return false;
  }
  return true;
}

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
  const notify = savingsNotifier();
  if (isHostedStagingWalletTopUpBlocked()) {
    notify(
      'Wallet top-up unavailable',
      'Card wallet top-ups are disabled in this hosted staging preview.',
      'warning'
    );
    return;
  }
  // A transient probe failure blocks with a retry affordance instead of a
  // dead end: the retry re-runs funding (and the probe) with these params.
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
    // Recovery runs before any amount validation: a saved primary-card
    // operation (possibly already charged) must be rechecked even when the
    // funding form holds its normal empty amount. New primary fundings
    // validate inside fundPrimaryWalletCard.
    try {
      return await fundPrimaryWalletCard({
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
    } catch (error) {
      // The server reports primary as unconfigured: fall through to the
      // working legacy top-up below instead of stranding the customer.
      if (!rollbackObservedCapabilityOnNotReady(activeMerchantId, error))
        throw error;
    }
  }
  const amount = Number(fundAmount);
  const amountValidationError = validateWalletTopUpAmount(amount);
  if (amountValidationError) {
    notify('Check the amount', amountValidationError, 'warning');
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
    notify(
      'Top-up didn’t start',
      error instanceof Error
        ? error.message
        : 'Failed to start wallet top-up. Please try again.',
      'warning'
    );
  } finally {
    setIsFundPending(false);
  }
}
