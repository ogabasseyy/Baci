import { renderHook, waitFor } from '@testing-library/react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useBillPayGate } from './use-bill-pay-gate';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const RETURN_TO = '/utilities/power' as WalletReturnHref;
const request = {
  amount: 1000,
  billerCode: 'ekedc',
  customerId: '1234567890',
  type: 'electricity' as const,
  walletAmount: 1000,
};

function storeCredit(balance: number) {
  return {
    canFundByBankTransfer: false,
    getWalletBalance: () => balance,
    hasRetainedVtuAttempt: () => false,
    isAuthenticated: true,
    isWalletSettled: () => true,
    walletError: null,
    walletIsLoading: false,
    walletIsStoreCredit: true,
    walletPrimaryUnknown: false,
  } as unknown as ReturnType<typeof useUtilityPayment>;
}

describe('useBillPayGate', () => {
  beforeEach(() => {
    useVtuWalletPayStore.setState({
      covers: () => false,
      retains: async () => false,
    });
  });

  it('asks for an amount above Pay before anything is typed', () => {
    const { result } = renderHook(() =>
      useBillPayGate({
        amountIssue: 'Enter an amount to pay.',
        formattedAmount: '',
        numericAmount: 0,
        payment: storeCredit(5000),
        purchaseRequest: null,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current).toMatchObject({
      blockedReason: 'Enter an amount to pay.',
      notice: { action: null, message: 'Enter an amount to pay.' },
    });
  });

  it('points to the amount field when the typed amount is out of range', () => {
    const { result } = renderHook(() =>
      useBillPayGate({
        amountIssue: 'Amount must be between ₦50 and ₦500,000.',
        formattedAmount: '20',
        numericAmount: 20,
        payment: storeCredit(5000),
        purchaseRequest: { ...request, amount: 20, walletAmount: 20 },
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current.blockedReason).toBe(
      'Amount must be between ₦50 and ₦500,000.'
    );
    expect(result.current.notice).toEqual({
      action: null,
      message: 'Check the amount above.',
    });
  });

  it('blocks a short store credit balance with the top-up link', async () => {
    const { result } = renderHook(() =>
      useBillPayGate({
        amountIssue: null,
        formattedAmount: '1,000',
        numericAmount: 1000,
        payment: storeCredit(0),
        purchaseRequest: request,
        returnToHref: RETURN_TO,
      })
    );

    await waitFor(() => expect(result.current.notice).not.toBeNull());
    expect(result.current.notice).toMatchObject({
      action: { label: 'Add store credit' },
      message: 'Not enough store credit to pay this.',
    });
  });

  it('allows a valid amount the balance covers', async () => {
    const { result } = renderHook(() =>
      useBillPayGate({
        amountIssue: null,
        formattedAmount: '1,000',
        numericAmount: 1000,
        payment: storeCredit(5000),
        purchaseRequest: request,
        returnToHref: RETURN_TO,
      })
    );

    await waitFor(() =>
      expect(result.current).toMatchObject({
        blockedReason: null,
        notice: null,
      })
    );
  });
});
