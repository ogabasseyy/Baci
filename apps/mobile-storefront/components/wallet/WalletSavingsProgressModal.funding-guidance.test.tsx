import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { User } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors, { palette } from '@/constants/Colors';
import { useAuthStore } from '@/stores/auth-store';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      autoplay,
      accessibilityLabel,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
    }) => {
      const viewProps = {
        autoplay,
        accessible: true,
        accessibilityRole: 'image',
        accessibilityLabel,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

const goal = {
  contribution_amount: 500,
  contribution_frequency: 'weekly' as const,
  current_amount: 50000,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_condition: 'Used',
  product_image: 'https://cdn.example.com/iphone.jpg',
  product_variant_label: 'Storage: 256GB',
  source_mode: 'manual' as const,
  status: 'active' as const,
  target_amount: 100000,
  title: 'iPhone 15 Pro',
};
const authUser: User = {
  id: 'customer-a',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('WalletSavingsProgressModal funding guidance', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: authUser, merchantId: 'merchant-a' });
  });
  it('shows the saved device condition legibly on the dark Add to savings sheet', () => {
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.dark}
        goal={{ ...goal, current_amount: 0, product_condition: 'new' }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );

    // Nothing saved yet: no progress card, just the device and funding.
    expect(screen.queryByText('YOUR PROGRESS')).toBeNull();
    const condition = screen.getByLabelText('Device condition: New');
    expect(StyleSheet.flatten(condition.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: palette.red[600],
        color: palette.white,
      })
    );
    expect(
      screen.getByRole('button', {
        name: 'Continue to payment',
      })
    ).toHaveAccessibilityState({ disabled: true });
    expect(
      screen.queryByRole('button', { name: 'Confirm savings top-up' })
    ).toBeNull();
    expect(
      screen.getByText('Add money to your wallet to save this amount.')
    ).toBeOnTheScreen();
  });

  it('shows funding guidance when a contribution exceeds the spendable wallet balance', () => {
    const onAddSavings = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.dark}
        goal={goal}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={onAddSavings}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={100}
      />
    );

    expect(
      screen.getByText('Add money to your wallet to save this amount.')
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Confirm savings top-up' })
    ).toBeNull();
    expect(onAddSavings).not.toHaveBeenCalled();
  });
});
