import { renderHook } from '@testing-library/react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useDataPayGate } from './use-data-pay-gate';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const RETURN_TO = '/utilities/data' as WalletReturnHref;

function payment(balance: number) {
  return {
    canFundByBankTransfer: false,
    getWalletBalance: () => balance,
    hasRetainedVtuAttempt: () => false,
    isAuthenticated: true,
    isWalletSettled: () => true,
    walletError: null,
    walletIsLoading: false,
    walletIsStoreCredit: false,
    walletPrimaryUnknown: false,
  } as unknown as ReturnType<typeof useUtilityPayment>;
}

const complete = {
  phoneNumber: '08031234567',
  planAmount: 500,
  returnToHref: RETURN_TO,
  selectedPlan: 'MTN-1GB',
  selectedProvider: 'mtn',
};

// With the server keeping PiggyVest off the data form's Pay depends only on
// the form and the plain wallet balance.
describe('useDataPayGate with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      retains: async () => false,
    });
  });

  it('allows a complete form the wallet covers', () => {
    const { result } = renderHook(() =>
      useDataPayGate({ ...complete, payment: payment(1000) })
    );

    expect(result.current).toEqual({
      blockedReason: null,
      inlineIssue: null,
      notice: null,
    });
  });

  it('asks for a bundle above Pay, not in an alert', () => {
    const { result } = renderHook(() =>
      useDataPayGate({
        ...complete,
        payment: payment(1000),
        selectedPlan: null,
      })
    );

    expect(result.current.blockedReason).toBe('Choose a data bundle.');
    expect(result.current.notice?.message).toBe('Choose a data bundle.');
  });

  it('flags a wrong full-length number at the field, not above Pay', () => {
    const { result } = renderHook(() =>
      useDataPayGate({
        ...complete,
        payment: payment(1000),
        phoneNumber: '12345678901',
      })
    );

    expect(result.current.inlineIssue?.field).toBe('phone');
    expect(result.current.notice).toBeNull();
    expect(result.current.blockedReason).toBe(
      'Enter an 11-digit phone number, like 08012345678.'
    );
  });

  it('blocks a short wallet with a link to open it', () => {
    const { result } = renderHook(() =>
      useDataPayGate({ ...complete, payment: payment(100) })
    );

    expect(result.current.notice).toMatchObject({
      action: { label: 'Open wallet' },
      message: 'Not enough in your wallet to pay this.',
    });
  });
});
