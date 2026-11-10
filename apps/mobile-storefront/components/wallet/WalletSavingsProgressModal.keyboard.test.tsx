import { expect, it, jest } from '@jest/globals';
import type { User } from '@supabase/supabase-js';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors, { BRAND } from '@/constants/Colors';
import { useAuthStore } from '@/stores/auth-store';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

const authUser: User = {
  id: 'customer-a',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
};

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({ keyboardHeight: 320 }),
}));

it.each([
  Colors.dark,
  Colors.light,
])('covers the underlying wallet behind the keyboard without enabling staging payments', (colors) => {
  const previousMode = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
  const brandReplacement = jest.replaceProperty(
    BRAND,
    'primary',
    Colors.light.success
  );
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  try {
    useAuthStore.setState({ user: authUser, merchantId: 'merchant-a' });
    const onFundWallet = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount="5000"
        colors={colors}
        goal={{
          contribution_amount: 500,
          contribution_frequency: 'weekly',
          // Some progress, so the branded progress card is shown.
          current_amount: 62500,
          id: 'goal-keyboard',
          maturity_date: '2026-09-30',
          product_condition: 'New',
          product_image: null,
          source_mode: 'manual',
          status: 'active',
          target_amount: 250000,
          title: 'Synthetic phone',
        }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={onFundWallet}
        visible
        walletBalance={0}
      />
    );

    const payment = screen.getByRole('button', {
      name: 'Wallet funding unavailable',
    });
    expect(payment).toHaveAccessibilityState({ disabled: true });
    expect(screen.getByText('Wallet funding unavailable')).toBeOnTheScreen();
    expect(
      screen.getByRole('header', { name: 'Add to savings' })
    ).toBeOnTheScreen();
    expect(
      screen.UNSAFE_getByType(SavingsBottomSheet).props.colors.primary
    ).toBe(BRAND.primary);
    expect(
      screen.getByRole('progressbar', { name: 'Savings plan progress details' })
    ).toHaveStyle({ backgroundColor: BRAND.primaryAlpha12 });
    expect(screen.getByText('A quarter of the way!')).toHaveStyle({
      color: BRAND.primary,
    });
    expect(
      screen.getByText(
        /Wallet top-ups are disabled in this hosted staging preview/i
      )
    ).toBeOnTheScreen();
    fireEvent.press(payment);
    expect(onFundWallet).not.toHaveBeenCalled();
  } finally {
    brandReplacement.restore();
    if (previousMode === undefined)
      delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previousMode;
  }
});
