import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { createWalletFundingAccount } from './create-wallet-funding-account';

const mockNotify = jest.fn();
jest.mock('./savings/savings-notifier', () => ({
  savingsNotifier: () => mockNotify,
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
  trackEvent: jest.fn(),
}));

const PIGGYVEST_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const params = (activeMerchantId: string) => ({
  activeMerchantId,
  createFundingAccount: jest.fn() as never,
  customerPhone: '',
  isPaymentSettingsError: false,
  isPaymentSettingsPending: false,
  walletDvaEnabled: true,
});

describe('wallet handler outcomes are scoped to the PiggyVest merchant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the inline notice (no iOS alert) for the PiggyVest merchant', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await createWalletFundingAccount(params(PIGGYVEST_MERCHANT));

    expect(mockNotify).toHaveBeenCalledWith(
      'Phone number required',
      expect.any(String),
      'warning'
    );
    expect(iosAlert).not.toHaveBeenCalled();
  });

  it('keeps today’s iOS alert for any other merchant', async () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await createWalletFundingAccount(
      params('11111111-1111-4111-8111-111111111111')
    );

    expect(iosAlert).toHaveBeenCalledWith(
      'Phone number required',
      expect.any(String)
    );
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
