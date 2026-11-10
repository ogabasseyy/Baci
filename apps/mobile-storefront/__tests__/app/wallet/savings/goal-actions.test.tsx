import { render, screen } from '@testing-library/react-native';

let mockParams: Record<string, string | string[] | undefined> = {};
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`Redirect:${href}`}</Text>;
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('@/components/wallet/savings/GoalLifecycleScreen', () => ({
  GoalLifecycleScreen: ({ kind, goalId }: { kind: string; goalId: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`Lifecycle:${kind}:${goalId}`}</Text>;
  },
}));

import WalletGoalActionsRoute from '@/app/wallet/savings/goal-actions';

describe('WalletGoalActionsRoute', () => {
  it.each([
    'cancel',
    'complete',
  ])('renders the lifecycle screen for %s', (kind) => {
    mockParams = { goalId: 'goal-1', kind };
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText(`Lifecycle:${kind}:goal-1`)).toBeOnTheScreen();
  });

  it('takes the first value of a repeated param', () => {
    mockParams = { goalId: ['goal-1', 'x'], kind: ['cancel'] };
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText('Lifecycle:cancel:goal-1')).toBeOnTheScreen();
  });

  it.each([
    [{ goalId: 'goal-1', kind: 'delete' }],
    [{ goalId: 'goal-1' }],
    [{ kind: 'cancel' }],
  ])('goes to the wallet for unusable params %j', (params) => {
    mockParams = params;
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
  });
});
