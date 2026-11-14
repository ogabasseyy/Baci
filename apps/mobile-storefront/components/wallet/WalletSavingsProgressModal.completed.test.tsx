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

describe('WalletSavingsProgressModal: completed goals', () => {
  it('says the purchase was requested for a settled completed goal', () => {
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={{ ...goal, current_amount: 0, status: 'completed' }}
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
      screen.getByText(
        'Purchase requested. Your savings have moved to your order.'
      )
    ).toBeOnTheScreen();
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

  it('offers exact variant recovery only for a completed unresolved goal', () => {
    const onResolveVariant = jest.fn();
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={{
          ...goal,
          selection_unresolved: true,
          status: 'completed',
          variant_resolution_options: [
            { id: 'variant-1', label: 'Used · Color: Black · Storage: 256GB' },
          ],
        }}
        isAdding={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        onResolveVariant={onResolveVariant}
        visible
        walletBalance={0}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Resolve savings device variant' })
    );
    expect(onResolveVariant).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Change savings device' })
    ).toBeNull();
  });

  it.each([
    [false, 'clear'],
    [true, 'pending'],
  ])('hands the goal and the pending state to the goal lifecycle entry (pending %s)', (hasPendingContribution, label) => {
    render(
      <WalletSavingsProgressModal
        addAmount=""
        colors={Colors.light}
        goal={goal}
        isAdding={false}
        hasPendingContribution={hasPendingContribution}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onChangeDevice={jest.fn()}
        onClose={jest.fn()}
        onFundWallet={jest.fn()}
        visible
        walletBalance={0}
      />
    );
    expect(screen.getByText(`lifecycle:goal-1:${label}`)).toBeOnTheScreen();
  });
});
