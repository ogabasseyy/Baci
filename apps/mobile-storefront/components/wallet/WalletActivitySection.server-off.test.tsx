import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletActivitySection } from './WalletActivitySection';
import { WalletPrimaryContext } from './WalletPrimaryContext';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-wallet-activity', () => ({
  fetchPiggyvestWalletActivity: (...args: unknown[]) => mockFetch(...args),
}));
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

describe('wallet activity section with the server keeping PiggyVest off', () => {
  it('keeps today’s Recent Transactions and never asks for PiggyVest activity', () => {
    render(
      <WalletPrimaryContext.Provider value={false}>
        <WalletActivitySection colors={Colors.light} transactions={[]} />
      </WalletPrimaryContext.Provider>
    );

    expect(screen.getByText('Recent Transactions')).toBeOnTheScreen();
    expect(screen.queryByTestId('piggyvest-wallet-activity')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
