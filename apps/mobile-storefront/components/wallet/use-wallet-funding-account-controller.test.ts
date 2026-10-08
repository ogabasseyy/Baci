import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { useWalletFundingAccountController } from './use-wallet-funding-account-controller';
import { createWalletFundingAccount } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({
  createWalletFundingAccount: jest.fn(),
}));

const mockCreate = jest.mocked(createWalletFundingAccount);

const enabledSettings = {
  wallet_paystack_dva_enabled: true,
} as PaymentSettings;

function buildParams(
  overrides: Partial<
    Parameters<typeof useWalletFundingAccountController>[0]
  > = {}
) {
  return {
    createFundingAccount: jest.fn(async () => ({ account: null })),
    customerPhone: null,
    isPaymentSettingsError: false,
    isPaymentSettingsPending: false,
    paymentSettings: enabledSettings,
    setShowFundPanel: jest.fn(),
    updateProfile: jest.fn(async () => ({ success: true })),
    ...overrides,
  } satisfies Parameters<typeof useWalletFundingAccountController>[0];
}

describe('useWalletFundingAccountController', () => {
  it('opens PiggyVest setup without creating a Paystack account or requiring Paystack settings', async () => {
    const params = buildParams({
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customerPhone: null,
      paymentSettings: null,
    });
    const { result } = renderHook(() =>
      useWalletFundingAccountController(params)
    );
    expect(result.current.needsPhone).toBe(true);
    await act(async () => {
      await result.current.onCreateFundingAccount();
    });
    expect(params.setShowFundPanel).toHaveBeenCalledWith(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(true);
  });

  it('flags needsPhone and blocks creation when the customer has no phone', () => {
    const { result } = renderHook(() =>
      useWalletFundingAccountController(buildParams())
    );

    expect(result.current.needsPhone).toBe(true);
    expect(result.current.canCreateFundingAccount).toBe(false);
  });

  it('persists the phone through updateProfile without retrying when not forced', async () => {
    const updateProfile = jest.fn(async () => ({ success: true }));
    const { result } = renderHook(() =>
      useWalletFundingAccountController(buildParams({ updateProfile }))
    );

    let outcome: { success: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.onSubmitPhone('08012345678');
    });

    expect(updateProfile).toHaveBeenCalledWith({ phone: '08012345678' });
    expect(outcome).toEqual({ success: true });
    // Normal flow leaves DVA creation to the panel's auto-create effect.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('forces the phone prompt on CUSTOMER_PHONE_REQUIRED and retries after saving', async () => {
    const setShowFundPanel = jest.fn();
    const updateProfile = jest.fn(async () => ({ success: true }));
    mockCreate.mockImplementationOnce(async (params) => {
      params.onPhoneRequired?.();
      return false;
    });

    const { result } = renderHook(() =>
      useWalletFundingAccountController(
        buildParams({
          customerPhone: '08012345678',
          setShowFundPanel,
          updateProfile,
        })
      )
    );

    // A local phone exists, so nothing is needed until the server disagrees.
    expect(result.current.needsPhone).toBe(false);
    expect(result.current.canCreateFundingAccount).toBe(true);

    await act(async () => {
      await result.current.onCreateFundingAccount();
    });

    // Server rejection forces the prompt and opens the panel (no dead-end
    // Alert). Creation is blocked even though the underlying availability
    // still says true, so a freshly mounted panel can't auto-create.
    expect(setShowFundPanel).toHaveBeenCalledWith(true);
    expect(result.current.needsPhone).toBe(true);
    expect(result.current.canCreateFundingAccount).toBe(false);

    await act(async () => {
      await result.current.onSubmitPhone('08098765432');
    });

    expect(updateProfile).toHaveBeenCalledWith({ phone: '08098765432' });
    // Initial attempt + explicit retry after the phone is saved.
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.current.needsPhone).toBe(false);
  });

  it('does not retry creation when the forced phone save fails', async () => {
    const updateProfile = jest.fn(async () => ({
      error: 'Session expired.',
      success: false,
    }));
    mockCreate.mockImplementationOnce(async (params) => {
      params.onPhoneRequired?.();
      return false;
    });

    const { result } = renderHook(() =>
      useWalletFundingAccountController(
        buildParams({ customerPhone: '08012345678', updateProfile })
      )
    );

    await act(async () => {
      await result.current.onCreateFundingAccount();
    });

    await act(async () => {
      await result.current.onSubmitPhone('08098765432');
    });

    // Only the initial attempt — a failed save must not retry creation.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.current.needsPhone).toBe(true);
  });
});
