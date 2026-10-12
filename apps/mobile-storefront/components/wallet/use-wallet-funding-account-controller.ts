import { useState } from 'react';
import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import type { Customer } from '@/stores/auth-store.types';
import { deriveWalletFundingAccountAvailability } from './deriveWalletFundingAccountAvailability';
import type { WalletFundPhoneSubmitResult } from './WalletFundPhonePrompt';
import { createWalletFundingAccount } from './wallet-screen.handlers';

type CreateFundingAccount = Parameters<
  typeof createWalletFundingAccount
>[0]['createFundingAccount'];

type UpdateProfile = (
  data: Partial<Customer>
) => Promise<{ error?: string; success: boolean }>;

interface UseWalletFundingAccountControllerParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  createFundingAccount: CreateFundingAccount;
  customerId?: string | null;
  customerPhone?: string | null;
  isPaymentSettingsError: boolean;
  isPaymentSettingsPending: boolean;
  paymentSettings?: PaymentSettings | null;
  setShowFundPanel: (value: boolean) => void;
  updateProfile: UpdateProfile;
}

/**
 * Owns the wallet funding-account interaction surface so WalletScreen stays
 * within its module-size budget: availability derivation, DVA creation, and
 * the phone-at-point-of-need flow (collect the customer's phone, then create
 * the account). Also maps the server's CUSTOMER_PHONE_REQUIRED rejection to a
 * forced phone prompt instead of a dead-end Alert, for stale-local-state races.
 */
export function useWalletFundingAccountController({
  activeMerchantId,
  activeMerchantSlug,
  createFundingAccount,
  customerId,
  customerPhone,
  isPaymentSettingsError,
  isPaymentSettingsPending,
  paymentSettings,
  setShowFundPanel,
  updateProfile,
}: UseWalletFundingAccountControllerParams) {
  const primaryCapability = usePiggyvestPrimaryCapability(activeMerchantId);
  const primaryObserved = Boolean(
    activeMerchantId && isPiggyvestPrimaryMerchant(activeMerchantId)
  );
  const primary = Boolean(primaryObserved && primaryCapability !== false);
  // A never-observed non-pilot merchant must wait for the first capability
  // verdict before creating a legacy DVA: creating now could orphan the
  // account when the merchant turns out primary-enabled.
  const primaryVerdictPending = Boolean(
    activeMerchantId && !primaryObserved && primaryCapability === null
  );
  const availability = deriveWalletFundingAccountAvailability({
    customerPhone,
    isPaymentSettingsError,
    isPaymentSettingsPending,
    paymentSettings,
    primaryVerdictPending,
    primaryWalletSetup: primary,
  });
  const [phoneRequiredOverride, setPhoneRequiredOverride] = useState(false);
  const needsPhone = availability.needsPhone || phoneRequiredOverride;

  const handleCreateFundingAccount = () => {
    if (primary) {
      setShowFundPanel(true);
      return Promise.resolve(false);
    }
    if (primaryVerdictPending) {
      // Defense in depth: the create CTA is already disabled with a checking
      // message while the verdict is pending; never mint a legacy DVA the
      // probe might orphan.
      return Promise.resolve(false);
    }
    return createWalletFundingAccount({
      activeMerchantId,
      activeMerchantSlug,
      createFundingAccount,
      customerId,
      customerPhone: availability.customerPhone,
      isPaymentSettingsError,
      isPaymentSettingsPending,
      onPhoneRequired: () => {
        setPhoneRequiredOverride(true);
        setShowFundPanel(true);
      },
      walletDvaEnabled: availability.walletDvaEnabled,
    });
  };

  const handleSubmitPhone = async (
    phone: string
  ): Promise<WalletFundPhoneSubmitResult> => {
    const result = await updateProfile({ phone });
    if (result.success && phoneRequiredOverride) {
      // The panel's auto-create latch already fired on the stale attempt, so it
      // won't re-fire on the availability flip — retry creation explicitly.
      setPhoneRequiredOverride(false);
      void handleCreateFundingAccount();
    }
    return result;
  };

  return {
    // Forced false while the phone prompt is showing (including the
    // server-forced override, where the underlying availability still says
    // true) so a freshly mounted panel can't auto-create a doomed request.
    canCreateFundingAccount:
      availability.canCreateFundingAccount && !needsPhone,
    createFundingAccountUnavailableMessage:
      availability.createFundingAccountUnavailableMessage,
    customerPhone: availability.customerPhone,
    isPaymentSettingsPending: availability.isPaymentSettingsPending,
    needsPhone,
    onCreateFundingAccount: handleCreateFundingAccount,
    onSubmitPhone: handleSubmitPhone,
    walletDvaEnabled: availability.walletDvaEnabled,
  };
}
