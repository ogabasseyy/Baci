import { render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import { WalletLoadingView } from './WalletLoadingView';

const props: ComponentProps<typeof WalletLoadingView> = {
  colors: Colors.dark,
  presentation: 'tab' as const,
  user: { id: 'user' },
  hasMerchantContext: true,
  query: {
    data: undefined,
    balancePreview: {
      balance: 100,
      total_balance: 300,
      savings_balance: 200,
      loyalty_points: 0,
    },
    isError: false,
    isLoading: true,
    refetch: jest.fn().mockResolvedValue(undefined),
  },
};
it('shows the balance preview while the complete wallet is still loading', () => {
  render(<WalletLoadingView {...props} />);
  expect(screen.getByText('₦300')).toBeOnTheScreen();
  expect(
    screen.getByLabelText('Loading account and activity')
  ).toBeOnTheScreen();
});
it('never shows the previous customer preview after sign out', () => {
  render(<WalletLoadingView {...props} user={null} />);
  expect(screen.queryByText('₦300')).toBeNull();
  expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();
});
