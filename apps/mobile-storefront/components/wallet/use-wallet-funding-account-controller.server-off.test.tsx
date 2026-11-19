import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { useWalletFundingAccountController } from './use-wallet-funding-account-controller';
import { createWalletFundingAccount } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({
  createWalletFundingAccount: jest.fn(async () => true),
}));
// The capability hook still holds its earlier positive answer.
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => true,
}));

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const mockCreate = jest.mocked(createWalletFundingAccount);

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  jest.clearAllMocks();
});

describe('bugfix: pilot rollback kept routing account creation to PiggyVest', () => {
  it('creates the legacy account once the live verdict rolls back to false', async () => {
    // Arrange: another flow rolled the pilot back to not ready.
    observePiggyvestPrimaryCapability(PILOT, false);
    const setShowFundPanel = jest.fn();
    const { result } = renderHook(() =>
      useWalletFundingAccountController({
        activeMerchantId: PILOT,
        createFundingAccount: jest.fn(async () => ({ account: null })),
        customerPhone: '08012345678',
        isPaymentSettingsError: false,
        isPaymentSettingsPending: false,
        paymentSettings: {
          wallet_paystack_dva_enabled: true,
        } as PaymentSettings,
        setShowFundPanel,
        updateProfile: jest.fn(async () => ({ success: true })),
      })
    );

    // Act
    await act(async () => {
      await result.current.onCreateFundingAccount();
    });

    // Assert: the Paystack account is provisioned, not the PiggyVest panel.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(setShowFundPanel).not.toHaveBeenCalled();
  });
});

describe('bugfix: account creation reopened PiggyVest setup after the rollback expired', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('neither opens PiggyVest setup nor provisions Paystack until a fresh verdict', async () => {
    // Arrange: rolled back, then the 60-second ruling-out expires.
    jest.useFakeTimers();
    observePiggyvestPrimaryCapability(PILOT, false);
    jest.advanceTimersByTime(61_000);
    const setShowFundPanel = jest.fn();
    const { result } = renderHook(() =>
      useWalletFundingAccountController({
        activeMerchantId: PILOT,
        createFundingAccount: jest.fn(async () => ({ account: null })),
        customerPhone: '08012345678',
        isPaymentSettingsError: false,
        isPaymentSettingsPending: false,
        paymentSettings: {
          wallet_paystack_dva_enabled: true,
        } as PaymentSettings,
        setShowFundPanel,
        updateProfile: jest.fn(async () => ({ success: true })),
      })
    );

    // Act
    await act(async () => {
      await result.current.onCreateFundingAccount();
    });

    // Assert: still checking: no PiggyVest panel and no Paystack account.
    expect(setShowFundPanel).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
