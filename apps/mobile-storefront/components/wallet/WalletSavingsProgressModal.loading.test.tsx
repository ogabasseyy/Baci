import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsBottomSheet } from './SavingsBottomSheet';
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
  const snapPoints = screen.getByTestId('gorhom-bottom-sheet').props.snapPoints;
  expect(snapPoints).toEqual(['72%', '92%']);
  expect(
    screen.getByTestId('gorhom-bottom-sheet').props.enableDynamicSizing
  ).toBe(false);
  expect(screen.UNSAFE_getByType(BottomSheetScrollView).props.style).toEqual({
    flex: 1,
  });
  expect(screen.getByText('Checking savings wallet…')).toBeOnTheScreen();

  view.rerender(
    <WalletSavingsProgressModal
      {...props}
      goal={{ ...goal, current_amount: 500 }}
    />
  );

  expect(screen.UNSAFE_getAllByType(SavingsBottomSheet)).toHaveLength(1);
  expect(screen.getByTestId('gorhom-bottom-sheet').props.snapPoints).toEqual(
    snapPoints
  );
  expect(screen.getByText('Ready actions')).toBeOnTheScreen();
});
