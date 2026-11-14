import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

import { setWalletTestCustomer } from './wallet-auth.test-support';

let restoreCustomer: () => void;
beforeEach(() => {
  restoreCustomer = setWalletTestCustomer();
});
afterEach(() => restoreCustomer());

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

jest.mock('./savings/GoalLifecycleEntry', () => ({
  GoalLifecycleEntry: ({
    goal,
    hasPendingContribution,
  }: {
    goal: { id: string };
    hasPendingContribution: boolean;
  }) => {
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return (
      <Text>{`lifecycle:${goal.id}:${hasPendingContribution ? 'pending' : 'clear'}`}</Text>
    );
  },
}));

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
  it('checks a pending contribution even when the reserved funds leave a zero wallet balance', () => {
    const onAddSavings = jest.fn();
    const onFundWallet = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.dark}
        goal={goal}
        isAdding={false}
        hasPendingContribution
        onAddAmountChange={jest.fn()}
        onAddSavings={onAddSavings}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={onFundWallet}
        visible
        walletBalance={0}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Check contribution status' })
    );
    expect(onAddSavings).toHaveBeenCalledTimes(1);
    expect(onFundWallet).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Continue to payment' })
    ).toBeNull();
  });
  it('allows an unresolved auto-debit goal to choose its exact device', () => {
    const onChangeDevice = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={{
          ...goal,
          source_mode: 'auto_debit',
          selection_unresolved: true,
        }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={onChangeDevice}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Change savings device' })
    );
    expect(onChangeDevice).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
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

    expect(screen.queryByText('Add to savings')).toBeNull();
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
      screen.queryByRole('button', {
        name: 'Continue to wallet payment for savings',
      })
    ).toBeNull();
  });

  // Codex P2: an add in flight is not "pending", but Cancel/Complete must
  // still stay hidden, or Cancel could take over the sheet and drop the
  // add's PIN prompt.
  it('keeps goal actions hidden while an add is in flight', () => {
    render(
      <WalletSavingsProgressModal
        addAmount="500"
        colors={Colors.dark}
        goal={goal}
        isAdding
        hasPendingContribution={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={5000}
      />
    );
    expect(screen.getByText('lifecycle:goal-1:pending')).toBeOnTheScreen();
  });
});
