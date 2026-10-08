import { describe, expect, it } from '@jest/globals';
import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { deriveWalletFundingAccountAvailability } from './deriveWalletFundingAccountAvailability';
import { WALLET_FUNDING_ACCOUNT_MESSAGES } from './wallet-funding-account.constants';

const enabledPaymentSettings = {
  wallet_paystack_dva_enabled: true,
} as PaymentSettings;

describe('deriveWalletFundingAccountAvailability', () => {
  it('opens primary wallet setup without manufacturing Paystack payment settings', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: ' 08012345678 ',
      isPaymentSettingsError: true,
      isPaymentSettingsPending: true,
      paymentSettings: null,
      primaryWalletSetup: true,
    });
    expect(availability).toMatchObject({
      canCreateFundingAccount: true,
      customerPhone: '08012345678',
      isPaymentSettingsPending: false,
      needsPhone: false,
    });
    expect(availability.createFundingAccountUnavailableMessage).toBeUndefined();
  });
  it('allows account creation when DVA is enabled and the customer has a phone number', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: ' 08012345678 ',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      paymentSettings: enabledPaymentSettings,
    });

    expect(availability).toMatchObject({
      canCreateFundingAccount: true,
      customerPhone: '08012345678',
      isPaymentSettingsPending: false,
      needsPhone: false,
      walletDvaEnabled: true,
    });
    expect(availability.createFundingAccountUnavailableMessage).toBeUndefined();
  });

  it('reports pending availability while payment settings are unresolved', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: '08012345678',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: true,
      paymentSettings: undefined,
    });

    expect(availability.canCreateFundingAccount).toBe(false);
    expect(availability.createFundingAccountUnavailableMessage).toBe(
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_CHECKING
    );
  });

  it('reports unavailable account creation when payment settings fail to load', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: '08012345678',
      isPaymentSettingsError: true,
      isPaymentSettingsPending: false,
      paymentSettings: enabledPaymentSettings,
    });

    expect(availability.canCreateFundingAccount).toBe(false);
    expect(availability.createFundingAccountUnavailableMessage).toBe(
      WALLET_FUNDING_ACCOUNT_MESSAGES.AVAILABILITY_ERROR
    );
  });

  it('requires DVA to be enabled before allowing account creation', () => {
    expect(
      deriveWalletFundingAccountAvailability({
        customerPhone: '08012345678',
        isPaymentSettingsError: false,
        isPaymentSettingsPending: false,
        paymentSettings: {
          ...enabledPaymentSettings,
          wallet_paystack_dva_enabled: false,
        },
      }).createFundingAccountUnavailableMessage
    ).toBe(WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED);
  });

  it('flags needsPhone (no static message) when a missing phone is the only blocker', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: ' ',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      paymentSettings: enabledPaymentSettings,
    });

    expect(availability).toMatchObject({
      canCreateFundingAccount: false,
      needsPhone: true,
      walletDvaEnabled: true,
    });
    // The phone UI replaces the static PHONE_REQUIRED copy.
    expect(availability.createFundingAccountUnavailableMessage).toBeUndefined();
  });

  it('does not flag needsPhone when DVA is disabled even if the phone is also missing', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: '',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      paymentSettings: {
        ...enabledPaymentSettings,
        wallet_paystack_dva_enabled: false,
      },
    });

    expect(availability.needsPhone).toBe(false);
    expect(availability.createFundingAccountUnavailableMessage).toBe(
      WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED
    );
  });

  it('treats null payment settings as resolved with DVA disabled', () => {
    const availability = deriveWalletFundingAccountAvailability({
      customerPhone: '08012345678',
      isPaymentSettingsError: false,
      isPaymentSettingsPending: false,
      paymentSettings: null,
    });

    expect(availability).toMatchObject({
      canCreateFundingAccount: false,
      isPaymentSettingsPending: false,
      walletDvaEnabled: false,
    });
    expect(availability.createFundingAccountUnavailableMessage).toBe(
      WALLET_FUNDING_ACCOUNT_MESSAGES.DVA_DISABLED
    );
  });
});
