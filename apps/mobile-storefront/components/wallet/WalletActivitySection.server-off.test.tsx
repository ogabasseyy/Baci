import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const mockIsPrimaryMerchant = jest.fn<(id?: string) => boolean>();
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string) => mockIsPrimaryMerchant(id),
}));

describe('bugfix: plain store credit pushed out by hidden mirrored rows', () => {
  const row = (id: string, source_type: string) => ({
    id,
    source_type,
    amount: 100,
    created_at: '2026-11-13T10:00:00.000Z',
    description: `Row ${id}`,
    type: 'credit' as const,
  });

  it('shows 20 plain rows after hiding 25 newer mirrored ones', () => {
    mockIsPrimaryMerchant.mockReturnValue(true);
    mockFetch.mockResolvedValue({ items: [], nextCursor: null });
    const mirrored = Array.from({ length: 25 }, (_, i) =>
      row(`m${i}`, 'piggyvest_primary_inflow')
    );
    const plain = Array.from({ length: 30 }, (_, i) => row(`p${i}`, 'refund'));

    render(
      <QueryClientProvider client={new QueryClient()}>
        <WalletPrimaryContext.Provider value>
          <WalletActivitySection
            colors={Colors.light}
            merchantId="merchant-1"
            transactions={[...mirrored, ...plain]}
          />
        </WalletPrimaryContext.Provider>
      </QueryClientProvider>
    );

    expect(screen.getByText('Row p0')).toBeOnTheScreen();
    expect(screen.getByText('Row p19')).toBeOnTheScreen();
    expect(screen.queryByText('Row p20')).toBeNull();
    expect(screen.queryByText('Row m0')).toBeNull();
  });

  it('still shows at most 20 rows when PiggyVest is off', () => {
    mockIsPrimaryMerchant.mockReturnValue(false);
    const plain = Array.from({ length: 30 }, (_, i) => row(`p${i}`, 'refund'));

    render(
      <WalletPrimaryContext.Provider value={false}>
        <WalletActivitySection colors={Colors.light} transactions={plain} />
      </WalletPrimaryContext.Provider>
    );

    expect(screen.getByText('Row p19')).toBeOnTheScreen();
    expect(screen.queryByText('Row p20')).toBeNull();
  });
});
