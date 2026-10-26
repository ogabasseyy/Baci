import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsCarousel } from './WalletSavingsCarousel';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('./WalletSavingsPlanCard', () => {
  const { Text, Pressable } = jest.requireActual('react-native');
  return {
    WalletSavingsPlanCard: ({
      goal,
      onOpen,
    }: {
      goal: WalletActiveSavingsGoal;
      onOpen: () => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${goal.title}`}
        onPress={onOpen}
      >
        <Text>{goal.current_amount}</Text>
      </Pressable>
    ),
  };
});
const first: WalletActiveSavingsGoal = {
  id: 'one',
  title: 'Phone',
  current_amount: 100,
  target_amount: 250000,
  status: 'active',
  source_mode: 'manual',
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  maturity_date: '2027-10-12',
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('opens the swiped plan by its own ID instead of contributing to the featured plan', () => {
  const onOpenFeatured = jest.fn();
  render(
    <WalletSavingsCarousel
      goals={[
        first,
        { ...first, id: 'two', title: 'Laptop', current_amount: 107.33 },
      ]}
      colors={Colors.dark}
      featuredGoalId="one"
      onOpenFeatured={onOpenFeatured}
    />
  );
  fireEvent(screen.getByTestId('savings-carousel'), 'layout', {
    nativeEvent: { layout: { width: 390 } },
  });
  fireEvent.press(screen.getByRole('button', { name: 'Open Laptop' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/wallet',
    params: { action: 'savings', savingsGoalId: 'two' },
  });
  expect(onOpenFeatured).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Open Phone' }));
  expect(onOpenFeatured).toHaveBeenCalledTimes(1);
});

it.each([
  ['featured', 'one'],
  ['non-featured', 'two'],
] as const)('starts a fresh plan when opening a resolved completed %s goal', (position, completedGoalId) => {
  const onOpenFeatured = jest.fn();
  render(
    <WalletSavingsCarousel
      goals={[
        { ...first, id: 'one', status: 'active' as const },
        {
          ...first,
          id: 'two',
          title: 'Laptop',
          current_amount: 100,
          status: 'active' as const,
        },
      ].map((goal) =>
        goal.id === completedGoalId
          ? { ...goal, status: 'completed' as const }
          : goal
      )}
      colors={Colors.dark}
      featuredGoalId={position === 'featured' ? completedGoalId : 'one'}
      onOpenFeatured={onOpenFeatured}
    />
  );
  fireEvent(screen.getByTestId('savings-carousel'), 'layout', {
    nativeEvent: { layout: { width: 390 } },
  });

  fireEvent.press(
    screen.getByRole('button', {
      name: `Open ${completedGoalId === 'one' ? 'Phone' : 'Laptop'}`,
    })
  );

  expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
  expect(onOpenFeatured).not.toHaveBeenCalled();
});

it('keeps unresolved completed goals on their recovery path before new-plan navigation', () => {
  const onOpenFeatured = jest.fn();
  render(
    <WalletSavingsCarousel
      goals={[
        { ...first, status: 'completed', selection_unresolved: true },
        {
          ...first,
          id: 'two',
          title: 'Laptop',
          status: 'completed',
          selection_unresolved: true,
        },
      ]}
      colors={Colors.dark}
      featuredGoalId="one"
      onOpenFeatured={onOpenFeatured}
    />
  );
  fireEvent(screen.getByTestId('savings-carousel'), 'layout', {
    nativeEvent: { layout: { width: 390 } },
  });

  fireEvent.press(screen.getByRole('button', { name: 'Open Phone' }));
  expect(onOpenFeatured).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();

  fireEvent.press(screen.getByRole('button', { name: 'Open Laptop' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/wallet',
    params: { action: 'savings', savingsGoalId: 'two' },
  });
});

it('does not show plan-management actions in the fresh-user carousel', () => {
  render(
    <WalletSavingsCarousel
      goals={[]}
      colors={Colors.dark}
      onOpenFeatured={jest.fn()}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'View all plans (0)' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Start a new plan' })).toBeNull();
});
