import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import {
  STORE_CREDIT_SCOPE_COPY,
  WalletTransactionHistory,
} from './WalletTransactionHistory';
import { WALLET_LIST_INSET } from './wallet-list-layout';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});

function renderHistory(primaryReady: boolean) {
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletTransactionHistory colors={Colors.light} transactions={[]} />
    </WalletPrimaryContext.Provider>
  );
}

const flatStyle = (
  node: { props: { style?: StyleProp<ViewStyle> } } | null | undefined
) => StyleSheet.flatten(node?.props.style) ?? {};

describe('bugfix: "No transactions yet" beside a ₦50,000 savings wallet', () => {
  it('names the list store credit activity for a PiggyVest customer', () => {
    renderHistory(true);

    expect(screen.getByText('Older store credit')).toBeOnTheScreen();
    expect(screen.getByText('No store credit activity yet')).toBeOnTheScreen();
    expect(screen.queryByText('No transactions yet')).toBeNull();
    // Says it covers only store credit, not the savings wallet (walk-through).
    expect(screen.getByText(STORE_CREDIT_SCOPE_COPY)).toBeOnTheScreen();
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps Recent Transactions exactly as today', () => {
    renderHistory(false);

    expect(screen.getByText('Recent Transactions')).toBeOnTheScreen();
    expect(screen.getByText('No transactions yet')).toBeOnTheScreen();
    expect(screen.queryByText(STORE_CREDIT_SCOPE_COPY)).toBeNull();
  });
});

describe('store credit card sits like the other wallet cards', () => {
  it('keeps the 16pt card margin with the heading inside the card padding', () => {
    renderHistory(true);

    const section = screen.getByText('Older store credit').parent?.parent;
    const flat = flatStyle(section);
    expect(flat.margin).toBe(16);
    expect(flat.paddingLeft).toBe(WALLET_LIST_INSET);
  });

  it('points to the wallet activity listed above, without a provider name', () => {
    expect(STORE_CREDIT_SCOPE_COPY).toBe(
      'Only older store credit, for purchases. Your wallet activity is listed above.'
    );
    expect(STORE_CREDIT_SCOPE_COPY).not.toMatch(
      /piggyvest|kuda|monnify|paystack/i
    );
  });
});

describe('bugfix: older store credit card was misaligned', () => {
  it('uses the same equal inner inset as the Wallet activity card', () => {
    renderHistory(true);

    const section = screen.getByText('Older store credit').parent?.parent;
    const flat = flatStyle(section);
    expect(flat.paddingLeft).toBe(WALLET_LIST_INSET);
    expect(flat.paddingRight).toBe(WALLET_LIST_INSET);
  });

  it('centres the empty state inside the card, with no lopsided offset', () => {
    renderHistory(true);

    const empty = screen.getByText('No store credit activity yet').parent
      ?.parent;
    expect(flatStyle(empty).paddingLeft).toBe(0);
    expect(flatStyle(empty).paddingRight).toBe(0);
  });

  it('leaves the plain Recent Transactions layout alone', () => {
    renderHistory(false);

    const section = screen.getByText('Recent Transactions').parent?.parent;
    expect(flatStyle(section).padding).toBe(20);
    expect(flatStyle(section).paddingRight).toBeUndefined();
  });
});

describe('bugfix: empty "Older store credit" shown to a brand-new customer', () => {
  it('hides it for a PiggyVest customer with no balance and no history', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <WalletTransactionHistory
          colors={Colors.light}
          storeCreditBalance={0}
          transactions={[]}
        />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.queryByText('Older store credit')).toBeNull();
  });

  it('keeps it while there is a balance or an unknown balance', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <WalletTransactionHistory
          colors={Colors.light}
          storeCreditBalance={1500}
          transactions={[]}
        />
        <WalletTransactionHistory colors={Colors.light} transactions={[]} />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.getAllByText('Older store credit')).toHaveLength(2);
  });

  it('never hides today’s Recent Transactions with PiggyVest off', () => {
    render(
      <WalletPrimaryContext.Provider value={false}>
        <WalletTransactionHistory
          colors={Colors.light}
          storeCreditBalance={0}
          transactions={[]}
        />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.getByText('Recent Transactions')).toBeOnTheScreen();
  });
});

describe('bugfix: a held IMEI charge showed as a finished purchase (walk M3)', () => {
  const charge = {
    amount: -500,
    created_at: '2026-11-15T10:00:00.000Z',
    description: 'IMEI check',
    id: 'tx-imei',
    type: 'redemption' as const,
  };

  it('marks a held charge as pending, for sight and screen readers', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <WalletTransactionHistory
          colors={Colors.light}
          transactions={[{ ...charge, pending: true }]}
        />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.getByText(/· Pending/)).toBeTruthy();
    expect(screen.getByLabelText(/IMEI check\. Pending\./)).toBeTruthy();
  });

  it('shows a finished charge without the mark', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <WalletTransactionHistory
          colors={Colors.light}
          transactions={[charge]}
        />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.queryByText(/Pending/)).toBeNull();
  });
});

describe('bugfix: a refunding IMEI charge read as pending (Muse)', () => {
  it('says the money is on its way back', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <WalletTransactionHistory
          colors={Colors.light}
          transactions={[
            {
              amount: -500,
              created_at: '2026-11-15T10:00:00.000Z',
              description: 'IMEI check',
              id: 'tx-imei',
              type: 'redemption',
              refunding: true,
            },
          ]}
        />
      </WalletPrimaryContext.Provider>
    );
    expect(screen.getByText(/· Refunding/)).toBeTruthy();
    expect(screen.queryByText(/Pending/)).toBeNull();
    expect(screen.getByLabelText(/IMEI check\. Refunding\./)).toBeTruthy();
  });
});
