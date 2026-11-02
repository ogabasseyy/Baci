import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WALLET_HISTORY_PAGE_SIZE } from '@/constants/wallet-history';
import {
  type WalletTransaction,
  WalletTransactionHistory,
} from './WalletTransactionHistory';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeIn: {
      duration: () => ({
        delay: () => ({}),
      }),
    },
  };
});

describe('WalletTransactionHistory', () => {
  const transactions: WalletTransaction[] = [
    {
      amount: 2500.75,
      created_at: '2026-04-21T12:30:00.000Z',
      description: 'Order cashback',
      id: 'tx-1',
      type: 'credit',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders formatted transaction items', () => {
    render(
      <WalletTransactionHistory
        colors={Colors.light}
        transactions={transactions}
      />
    );

    expect(screen.getByText('Recent Transactions')).toBeTruthy();
    expect(screen.getByText('Order cashback')).toBeTruthy();
    expect(screen.getByText('+₦2,500.75')).toBeTruthy();
  });

  it('renders refund transactions as wallet inflows', () => {
    render(
      <WalletTransactionHistory
        colors={Colors.light}
        transactions={[
          {
            amount: 1200,
            created_at: '2026-05-01T09:00:00.000Z',
            description: 'Refund - Wallet top-up',
            id: 'tx-refund-1',
            type: 'refund',
          },
        ]}
      />
    );

    expect(screen.getByText('Refund - Wallet top-up')).toBeTruthy();
    expect(screen.getByText('+₦1,200')).toBeTruthy();
  });

  it('caps only the displayed rows without removing transactions from its input', () => {
    const history = Array.from(
      { length: WALLET_HISTORY_PAGE_SIZE + 2 },
      (_, index): WalletTransaction => ({
        ...transactions[0],
        id: `history-${index}`,
        description: `History row ${index + 1}`,
      })
    );
    const original = [...history];

    render(
      <WalletTransactionHistory colors={Colors.light} transactions={history} />
    );

    for (let index = 0; index < WALLET_HISTORY_PAGE_SIZE; index += 1) {
      expect(screen.getByText(`History row ${index + 1}`)).toBeTruthy();
    }
    expect(
      screen.queryByText(`History row ${WALLET_HISTORY_PAGE_SIZE + 1}`)
    ).toBeNull();
    expect(
      screen.queryByText(`History row ${WALLET_HISTORY_PAGE_SIZE + 2}`)
    ).toBeNull();
    expect(history).toEqual(original);
    expect(history).toHaveLength(WALLET_HISTORY_PAGE_SIZE + 2);
  });

  it('shows the empty state when there are no transactions', () => {
    render(
      <WalletTransactionHistory colors={Colors.light} transactions={[]} />
    );

    expect(screen.getByText('No transactions yet')).toBeTruthy();
  });
});
