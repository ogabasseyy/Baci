import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
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

describe('WalletSavingsProgressModal', () => {
  it('renders progress and wires manual contribution actions', () => {
    const onAddAmountChange = jest.fn();
    const onAddSavings = jest.fn();
    const onChangeDevice = jest.fn();
    const onClose = jest.fn();
    const onFundWallet = jest.fn();

    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        onAddAmountChange={onAddAmountChange}
        onAddSavings={onAddSavings}
        onChangeDevice={onChangeDevice}
        onClose={onClose}
        onFundWallet={onFundWallet}
        visible
        walletBalance={125000}
      />
    );

    expect(screen.getByText('Saving streak')).toBeOnTheScreen();
    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(screen.getByText('₦50,000 left')).toBeOnTheScreen();
    expect(screen.getByText('Used')).toBeOnTheScreen();
    expect(screen.getByText('Storage: 256GB')).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText('Savings top-up amount'), '500');
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Fund wallet for savings' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Change savings device' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Close savings progress' })
    );

    expect(onAddAmountChange).toHaveBeenCalledWith('500');
    expect(onAddSavings).toHaveBeenCalledTimes(1);
    expect(onFundWallet).toHaveBeenCalledTimes(1);
    expect(onChangeDevice).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('bugfix: animated wallet product images', () => {
    it('does not autoplay savings goal product images', () => {
      render(
        <WalletSavingsProgressModal
          addAmount=""
          colors={Colors.light}
          goal={{
            ...goal,
            product_image: 'https://cdn.example.com/iphone.gif',
          }}
          isAdding={false}
          onAddAmountChange={jest.fn()}
          onAddSavings={jest.fn()}
          onChangeDevice={jest.fn()}
          onClose={jest.fn()}
          onFundWallet={jest.fn()}
          visible
          walletBalance={125000}
        />
      );

      expect(
        screen.getByRole('image', { name: 'iPhone 15 Pro' }).props.autoplay
      ).toBe(false);
    });
  });

  it('returns no content when there is no active savings goal', () => {
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={null}
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

    expect(screen.queryByText('Saving streak')).toBeNull();
  });

  it('disables the confirm action while a contribution is pending', () => {
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.light}
        goal={goal}
        isAdding
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={125000}
      />
    );

    expect(screen.getByText('Adding...')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    ).toHaveAccessibilityState({ disabled: true, busy: true });
  });

  it('shows the auto-debit hint instead of manual controls for auto-debit goals', () => {
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={{ ...goal, source_mode: 'auto_debit' }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={125000}
      />
    );

    expect(
      screen.getByText('This goal is funded by scheduled auto-debit.')
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Confirm savings top-up' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Fund wallet for savings' })
    ).toBeNull();
  });

  it('hides manual controls when the savings goal is completed', () => {
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={{ ...goal, current_amount: 100000, status: 'completed' }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={125000}
      />
    );

    expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
    expect(
      screen.getByText('This savings goal is complete.')
    ).toBeOnTheScreen();
  });
});
