import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { WalletTransactionHistory } from './WalletTransactionHistory';

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

    expect(screen.getByText('Store credit activity')).toBeOnTheScreen();
    expect(screen.getByText('No store credit activity yet')).toBeOnTheScreen();
    expect(screen.queryByText('No transactions yet')).toBeNull();
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps Recent Transactions exactly as today', () => {
    renderHistory(false);

    expect(screen.getByText('Recent Transactions')).toBeOnTheScreen();
    expect(screen.getByText('No transactions yet')).toBeOnTheScreen();
  });
});
