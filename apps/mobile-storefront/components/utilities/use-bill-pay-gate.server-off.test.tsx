import { renderHook, waitFor } from '@testing-library/react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useBillPayGate } from './use-bill-pay-gate';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const request = {
  amount: 1000,
  billerCode: 'ekedc',
  customerId: '1234567890',
  type: 'electricity' as const,
  walletAmount: 1000,
};

function wallet(balance: number) {
  return {
    canFundByBankTransfer: true,
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

// With the server keeping PiggyVest off the bill form's Pay depends only on
// the amount and the plain wallet balance.
describe('useBillPayGate with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      retains: async () => false,
    });
  });

  it('blocks a short wallet with a bank-transfer funding link', async () => {
    const { result } = renderHook(() =>
      useBillPayGate({
        amountIssue: null,
        formattedAmount: '1,000',
        numericAmount: 1000,
        payment: wallet(200),
        purchaseRequest: request,
        returnToHref: '/utilities/power' as WalletReturnHref,
      })
    );

    await waitFor(() => expect(result.current.notice).not.toBeNull());
    expect(result.current.notice).toMatchObject({
      action: { label: 'Fund wallet' },
      message: 'Not enough in your wallet to pay this.',
    });
  });

  it('allows a wallet that covers the bill', async () => {
    const { result } = renderHook(() =>
      useBillPayGate({
        amountIssue: null,
        formattedAmount: '1,000',
        numericAmount: 1000,
        payment: wallet(5000),
        purchaseRequest: request,
        returnToHref: '/utilities/power' as WalletReturnHref,
      })
    );

    await waitFor(() => expect(result.current.blockedReason).toBeNull());
    expect(result.current.notice).toBeNull();
  });
});
