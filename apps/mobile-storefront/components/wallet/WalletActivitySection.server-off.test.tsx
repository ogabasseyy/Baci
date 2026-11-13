import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ActivityQueryWrapper } from './activity/activity-test-harness.test-support';
import { WalletActivitySection } from './WalletActivitySection';
import { WalletPrimaryContext } from './WalletPrimaryContext';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-wallet-activity', () => ({
  fetchPiggyvestWalletActivity: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { user: { id: string } }) => unknown) =>
    select({ user: { id: 'customer-1' } }),
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

describe('wallet activity is the PiggyVest merchant’s only (owner 2026-11-13)', () => {
  it('never shows or fetches it for another store, even if its wallet reads ready', () => {
    render(
      <WalletPrimaryContext.Provider value>
        <WalletActivitySection
          colors={Colors.light}
          merchantId="11111111-1111-4111-8111-111111111111"
          transactions={[]}
        />
      </WalletPrimaryContext.Provider>
    );

    expect(screen.queryByTestId('piggyvest-wallet-activity')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('wallet activity for the PiggyVest merchant', () => {
  it('shows the activity card above the older store credit list', async () => {
    mockFetch.mockResolvedValue({ items: [], nextCursor: null });
    render(
      <ActivityQueryWrapper>
        <WalletPrimaryContext.Provider value>
          <WalletActivitySection
            colors={Colors.light}
            merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
            transactions={[]}
          />
        </WalletPrimaryContext.Provider>
      </ActivityQueryWrapper>
    );

    expect(screen.getByTestId('piggyvest-wallet-activity')).toBeOnTheScreen();
    expect(await screen.findByText('No wallet activity yet')).toBeOnTheScreen();
    expect(screen.getByText('Older store credit')).toBeOnTheScreen();
  });
});
