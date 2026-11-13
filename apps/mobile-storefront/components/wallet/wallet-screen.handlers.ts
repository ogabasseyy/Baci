import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { Alert } from 'react-native';
import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { createLogger } from '@/lib/logger';
import { rollbackObservedCapabilityOnNotReady } from '@/lib/piggyvest-primary-capability';
import { trackError, trackEvent } from '@/services/analytics';
import { scheduleLocalNotification } from '@/services/push-notifications';
import {
  fundPrimaryWalletCard,
  NOTHING_TO_RECOVER,
} from './fund-primary-wallet-card';
import { resolveFundWalletRail } from './resolve-fund-wallet-rail';
import { runExclusiveWalletFunding } from './run-exclusive-wallet-funding';
import { startLegacyWalletTopUp } from './start-legacy-wallet-top-up';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';
import {
  resolveCreateFundingAccountOutcome,
  resolveWalletRedeemPointsOutcome,
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
  refetchWalletBalance?: () => Promise<unknown>;
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

export function fundWallet(params: FundWalletParams): Promise<void> {
  const scope = `${params.activeMerchantId ?? ''}:${params.user?.id ?? ''}`;
  return runExclusiveWalletFunding(scope, () => fundWalletOnce(params));
}

async function fundWalletOnce({
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
  if (isHostedStagingWalletTopUpBlocked()) {
    Alert.alert(
      'Wallet top-up unavailable',
      'Card wallet top-ups are disabled in this hosted staging preview.'
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
  await startLegacyWalletTopUp({
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
