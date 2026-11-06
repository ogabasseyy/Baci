import { render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import Colors from '@/constants/Colors';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';

jest.mock('./WalletSavingsFundingSection', () => ({
  WalletSavingsFundingSection: ({
    goal,
  }: {
    goal: { current_amount: number };
  }) => {
    const { Text } = require('react-native');
    return (
      <Text>
        {goal.current_amount < 500
          ? 'Checking savings wallet…'
          : 'Ready actions'}
      </Text>
    );
  },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

const goal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly' as const,
  current_amount: 400,
  id: 'cold-goal',
  maturity_date: '2026-12-01',
  source_mode: 'manual' as const,
  status: 'active' as const,
  target_amount: 250000,
  title: 'Phone',
};

it('keeps one bounded, scrollable sheet as its asynchronous body grows', () => {
  const props = {
    addAmount: '1000',
    colors: Colors.light,
    goal,
    isAdding: false,
    onAddAmountChange: jest.fn(),
    onAddSavings: jest.fn(),
    onChangeDevice: jest.fn(),
    onClose: jest.fn(),
    onFundWallet: jest.fn(),
    visible: true,
    walletBalance: 0,
  };
  const view = render(<WalletSavingsProgressModal {...props} />);
  const fixedHeight = StyleSheet.flatten(
    screen.UNSAFE_getByType(ModalSheet).props.cardStyle
  ).height;

  expect(fixedHeight).toBe('88%');
  expect(screen.UNSAFE_getByType(ScrollView).props.style).toEqual({ flex: 1 });
  expect(screen.getByText('Checking savings wallet…')).toBeOnTheScreen();

  view.rerender(
    <WalletSavingsProgressModal
      {...props}
      goal={{ ...goal, current_amount: 500 }}
    />
  );

  expect(screen.UNSAFE_getAllByType(ModalSheet)).toHaveLength(1);
  expect(
    StyleSheet.flatten(screen.UNSAFE_getByType(ModalSheet).props.cardStyle)
      .height
  ).toBe(fixedHeight);
  expect(screen.getByText('Ready actions')).toBeOnTheScreen();
});
