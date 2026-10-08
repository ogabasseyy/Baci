import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';

interface DeriveWalletFundingAccountAvailabilityParams {
  customerPhone?: string | null;
  isPaymentSettingsError: boolean;
  isPaymentSettingsPending: boolean;
  paymentSettings?: PaymentSettings | null;
  primaryWalletSetup?: boolean;
}

export interface WalletFundingAccountAvailability {
  canCreateFundingAccount: boolean;
  createFundingAccountUnavailableMessage?: string;
  customerPhone: string;
  isPaymentSettingsPending: boolean;
  needsPhone: boolean;
  walletDvaEnabled: boolean;
}

export function deriveWalletFundingAccountAvailability({
  customerPhone,
  isPaymentSettingsError,
  isPaymentSettingsPending,
  paymentSettings,
  primaryWalletSetup = false,
}: DeriveWalletFundingAccountAvailabilityParams): WalletFundingAccountAvailability {
  const walletDvaEnabled =
    primaryWalletSetup || paymentSettings?.wallet_paystack_dva_enabled === true;
  const normalizedCustomerPhone = customerPhone?.trim() ?? '';
  let createFundingAccountUnavailableMessage: string | undefined;
  let needsPhone = false;

  if (!primaryWalletSetup && isPaymentSettingsPending) {
    createFundingAccountUnavailableMessage =
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_CHECKING;
  } else if (!primaryWalletSetup && isPaymentSettingsError) {
    createFundingAccountUnavailableMessage =
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_ERROR;
  } else if (!walletDvaEnabled) {
    createFundingAccountUnavailableMessage =
      WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED;
  } else if (!normalizedCustomerPhone) {
    // Missing phone is the ONLY blocker: don't surface a static message —
    // the fund panel collects the number at the point of need instead.
    needsPhone = true;
  }

  return {
    // Still cannot create until the phone is collected; computed independently
    // of the message so suppressing the PHONE_REQUIRED copy can't flip it true.
    canCreateFundingAccount:
      !createFundingAccountUnavailableMessage && !needsPhone,
    createFundingAccountUnavailableMessage,
    customerPhone: normalizedCustomerPhone,
    isPaymentSettingsPending: !primaryWalletSetup && isPaymentSettingsPending,
    needsPhone,
    walletDvaEnabled,
  };
}
