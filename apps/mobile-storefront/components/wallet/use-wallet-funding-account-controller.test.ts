import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { useWalletFundingAccountController } from './use-wallet-funding-account-controller';
import { createWalletFundingAccount } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({
  createWalletFundingAccount: jest.fn(),
}));

const mockUseCapability = jest.fn();
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: (...args: unknown[]) =>
    mockUseCapability(...args),
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
  it('routes primary merchants through legacy creation when the server reports unconfigured', async () => {
    mockUseCapability.mockReturnValue(false);
    const params = buildParams({
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customerPhone: '08012345678',
    });
    const { result } = renderHook(() =>
      useWalletFundingAccountController(params)
    );
    await act(async () => {
      await result.current.onCreateFundingAccount();
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(params.setShowFundPanel).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(true);
    mockUseCapability.mockReturnValue(null);
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

  it('blocks legacy creation while a non-pilot merchant awaits the first capability verdict', async () => {
    mockUseCapability.mockReturnValue(null);
    const params = buildParams({
      activeMerchantId: '00000000-0000-0000-0000-000000000001',
      customerPhone: '08012345678',
    });
    const { result } = renderHook(() =>
      useWalletFundingAccountController(params)
    );

    // Cold start: the probe has not resolved, so creation waits instead of
    // minting a legacy DVA a primary verdict would orphan.
    expect(result.current.canCreateFundingAccount).toBe(false);
    expect(result.current.createFundingAccountUnavailableMessage).toBe(
      'Checking account number availability...'
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.onCreateFundingAccount();
    });

    expect(outcome).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(params.setShowFundPanel).not.toHaveBeenCalled();
  });

  it('unblocks legacy creation once a non-pilot merchant resolves to not-ready', async () => {
    mockUseCapability.mockReturnValue(false);
    const params = buildParams({
      activeMerchantId: '00000000-0000-0000-0000-000000000001',
      customerPhone: '08012345678',
    });
    const { result } = renderHook(() =>
      useWalletFundingAccountController(params)
    );

    expect(result.current.canCreateFundingAccount).toBe(true);

    await act(async () => {
      await result.current.onCreateFundingAccount();
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(params.setShowFundPanel).not.toHaveBeenCalled();
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
