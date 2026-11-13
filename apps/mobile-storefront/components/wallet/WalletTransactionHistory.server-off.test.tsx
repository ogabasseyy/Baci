import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import {
  STORE_CREDIT_SCOPE_COPY,
  WalletTransactionHistory,
} from './WalletTransactionHistory';

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

describe('bugfix: store credit heading indented past the wallet cards', () => {
  it('lines the heading up with the 16pt card edge, not 36pt', () => {
    renderHistory(true);

    const heading = screen.getByText('Older store credit');
    const section = heading.parent?.parent;
    const flat = Object.assign(
      {},
      ...([section?.props.style]
        .flat(Number.POSITIVE_INFINITY)
        .filter(Boolean) as object[])
    ) as { margin?: number; paddingHorizontal?: number };
    expect(flat.margin).toBe(16);
    expect(flat.paddingHorizontal).toBe(0);
  });

  it('points to the PiggyVest wallet activity listed above', () => {
    expect(STORE_CREDIT_SCOPE_COPY).toMatch(/older store credit/);
    expect(STORE_CREDIT_SCOPE_COPY).toMatch(/PiggyVest savings wallet/);
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
