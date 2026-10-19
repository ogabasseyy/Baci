import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({ keyboardHeight: 320 }),
}));

it.each([
  Colors.dark,
  Colors.light,
])('covers the underlying wallet behind the keyboard without enabling staging payments', (colors) => {
  const previousMode = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  try {
    const onFundWallet = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount="5000"
        colors={colors}
        goal={{
          contribution_amount: 500,
          contribution_frequency: 'weekly',
          current_amount: 0,
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
      name: 'Continue to payment',
    });
    expect(payment).toHaveAccessibilityState({ disabled: true });
    expect(
      screen.getByText(
        /Wallet top-ups are disabled in this hosted staging preview/i
      )
    ).toBeOnTheScreen();
    fireEvent.press(payment);
    expect(onFundWallet).not.toHaveBeenCalled();
    expect(screen.getByTestId('modal-keyboard-surface')).toHaveStyle({
      height: 320,
      backgroundColor: colors.background,
    });
    expect(screen.getByTestId('keyboard-container')).toHaveProp(
      'automaticOffset',
      true
    );
    expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe(
      'on-drag'
    );
  } finally {
    if (previousMode === undefined)
      delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previousMode;
  }
});
