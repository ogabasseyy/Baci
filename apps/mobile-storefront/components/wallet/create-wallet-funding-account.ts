import { trackError } from '@/services/analytics';
import { walletOutcomeNotifier } from './fund/wallet-outcome-notifier';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';
import { resolveCreateFundingAccountOutcome } from './wallet-screen.helpers';

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

/**
 * Creates the customer's wallet account number. The PiggyVest merchant sees
 * each refusal as the inline wallet notice; every other store keeps today's
 * iOS alert.
 */
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
  // PiggyVest merchant: inline wallet notice. Others: today's iOS alert.
  const notify = walletOutcomeNotifier(activeMerchantId);
  if (isPaymentSettingsPending) {
    notify(
      {
        title: 'Account number unavailable',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_CHECKING,
        tone: 'info',
      },
      {
        title: 'Account number unavailable',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_CHECKING,
      }
    );
    return false;
  }

  if (isPaymentSettingsError) {
    notify(
      {
        title: 'Account number unavailable',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_ERROR,
        tone: 'warning',
      },
      {
        title: 'Account number unavailable',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_ERROR,
      }
    );
    return false;
  }

  if (!walletDvaEnabled) {
    notify(
      {
        title: 'Account number unavailable',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED,
        tone: 'warning',
      },
      {
        title: 'Account number unavailable',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED,
      }
    );
    return false;
  }

  if (!customerPhone) {
    notify(
      {
        title: 'Phone number required',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.PHONE_REQUIRED,
        tone: 'warning',
      },
      {
        title: 'Phone number required',
        message: WALLET_FUNDING_ACCOUNT_MESSAGES.PHONE_REQUIRED,
      }
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
    notify(
      {
        title: 'Unable to create account number',
        message: outcome.alertMessage,
        tone: 'warning',
      },
      {
        title: 'Unable to create account number',
        message: outcome.alertMessage,
      }
    );
    return false;
  }
  return true;
}
