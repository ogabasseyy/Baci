import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import { useWalletBalanceContractWarning } from './use-wallet-balance-contract-warning';

const mockWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: (...args: unknown[]) => mockWarn(...args),
  }),
}));

function WalletBalanceWarningHarness(
  props: Parameters<typeof useWalletBalanceContractWarning>[0]
) {
  useWalletBalanceContractWarning(props);
  return null;
}

describe('useWalletBalanceContractWarning', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('logs missing balance fields once per wallet owner', async () => {
    render(
      <WalletBalanceWarningHarness
        merchantId="merchant-a"
        ownerId="owner-a"
        walletData={{ balance: 5000 }}
      />
    );

    await waitFor(() => expect(mockWarn).toHaveBeenCalledTimes(1));
    expect(mockWarn).toHaveBeenCalledWith(
      'Wallet API balance contract warning; using safe display values.',
      expect.objectContaining({
        fallbackValues: {
          savings_balance: 0,
          total_balance: 5000,
        },
        missingFields: ['savings_balance', 'total_balance'],
      })
    );
  });

  it('logs total balance mismatches without missing field fallbacks', async () => {
    render(
      <WalletBalanceWarningHarness
        merchantId="merchant-b"
        ownerId="owner-b"
        walletData={{
          balance: 5000,
          savings_balance: 2500,
          total_balance: 5000,
        }}
      />
    );

    await waitFor(() => expect(mockWarn).toHaveBeenCalledTimes(1));
    expect(mockWarn).toHaveBeenLastCalledWith(
      'Wallet API balance contract warning; using safe display values.',
      expect.objectContaining({
        computedTotalBalance: 7500,
        fallbackValues: {},
        mismatchedFields: ['total_balance'],
        missingFields: [],
        serverTotalBalance: 5000,
      })
    );
  });

  it('skips warnings when identity context is incomplete', async () => {
    render(
      <WalletBalanceWarningHarness
        merchantId={null}
        ownerId="owner-c"
        walletData={{ balance: 5000 }}
      />
    );

    await waitFor(() => expect(mockWarn).not.toHaveBeenCalled());
  });
});
