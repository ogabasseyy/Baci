import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { createLogger } from '@/lib/logger';
import { initializeWalletTopUp } from '@/lib/wallet-top-up';
import { trackError, trackEvent } from '@/services/analytics';
import { scheduleLocalNotification } from '@/services/push-notifications';
import { fundPrimaryWalletCard } from './fund-primary-wallet-card';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';
import {
  buildWalletTopUpGatewayParams,
  getWalletCustomerName,
  resolveCreateFundingAccountOutcome,
  resolveWalletRedeemPointsOutcome,
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
type RedeemPoints = Parameters<
  typeof resolveWalletRedeemPointsOutcome
>[0]['redeemPoints'];

interface WalletFundingAccountHandlerParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  createFundingAccount: CreateFundingAccount;
  customerId?: string | null;
  customerPhone: string;
  isPaymentSettingsError: boolean;
  isPaymentSettingsPending: boolean;
  // Invoked when the server rejects with CUSTOMER_PHONE_REQUIRED so the caller
  // can show the phone prompt instead of a dead-end Alert.
  onPhoneRequired?: () => void;
  walletDvaEnabled: boolean;
}

interface FundWalletParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  customer?: WalletHandlerCustomer | null;
  fundAmount: string;
  resetFundPanel: () => void;
  setIsFundPending: (isPending: boolean) => void;
  user?: WalletHandlerUser | null;
  walletReturnTo?: string;
}

interface RedeemWalletPointsParams {
  clearRedeemPoints: () => void;
  closeRedeemPanel: () => void;
  customerId?: string | null;
  rawPoints: string;
  redeemPoints: RedeemPoints;
}

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
  if (isPaymentSettingsPending) {
    Alert.alert(
      'Account number unavailable',
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_CHECKING
    );
    return false;
  }

  if (isPaymentSettingsError) {
    Alert.alert(
      'Account number unavailable',
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_ERROR
    );
    return false;
  }

  if (!walletDvaEnabled) {
    Alert.alert(
      'Account number unavailable',
      WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED
    );
    return false;
  }

  if (!customerPhone) {
    Alert.alert(
      'Phone number required',
      WALLET_FUNDING_ACCOUNT_MESSAGES.PHONE_REQUIRED
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
    Alert.alert('Unable to create account number', outcome.alertMessage);
    return false;
  }
  return true;
}

export async function fundWallet({
  activeMerchantId,
  activeMerchantSlug,
  customer,
  fundAmount,
  resetFundPanel,
  setIsFundPending,
  user,
  walletReturnTo,
}: FundWalletParams): Promise<void> {
  const amount = Number(fundAmount);
  const amountValidationError = validateWalletTopUpAmount(amount);
  if (amountValidationError) {
    Alert.alert('Invalid Amount', amountValidationError);
    return;
  }
  if (isHostedStagingWalletTopUpBlocked()) {
    Alert.alert(
      'Wallet top-up unavailable',
      'Card wallet top-ups are disabled in this hosted staging preview.'
    );
    return;
  }
  if (isPiggyvestPrimaryMerchant(activeMerchantId)) {
    return fundPrimaryWalletCard({
      activeMerchantId,
      activeMerchantSlug,
      customer,
      fundAmount,
      resetFundPanel,
      setIsFundPending,
      user,
      walletReturnTo,
    });
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
    Alert.alert(
      'Top-up Failed',
      error instanceof Error
        ? error.message
        : 'Failed to start wallet top-up. Please try again.'
    );
  } finally {
    setIsFundPending(false);
  }
}

export async function redeemWalletPoints({
  clearRedeemPoints,
  closeRedeemPanel,
  customerId,
  rawPoints,
  redeemPoints,
}: RedeemWalletPointsParams): Promise<void> {
  const outcome = await resolveWalletRedeemPointsOutcome({
    minimumRedeemablePoints: VTU_MIN_REDEEMABLE_POINTS,
    rawPoints,
    redeemPoints,
  });
  if (outcome.status === 'invalid') {
    Alert.alert(outcome.title, outcome.message);
    return;
  }
  if (outcome.status === 'error') {
    log.error('Redemption error:', outcome.alertMessage);
    trackError('loyalty_redemption_failed', outcome.telemetryMessage, {
      points_attempted: outcome.points,
      customer_id: customerId,
    });
    Alert.alert('Error', outcome.alertMessage);
    return;
  }
  trackEvent('loyalty_redeemed', {
    points_redeemed: outcome.points,
    wallet_credit: outcome.result.walletCredit,
    remaining_points: outcome.result.remainingPoints,
    conversion_rate: outcome.result.conversionRate,
    customer_id: customerId,
  });
  await scheduleLocalNotification(
    'Points Redeemed! 🎁',
    outcome.successMessage,
    { type: 'loyalty_redemption', points: outcome.points },
    1
  );
  Alert.alert('Points Redeemed!', outcome.successMessage, [
    { text: 'OK', onPress: closeRedeemPanel },
  ]);
  clearRedeemPoints();
}
