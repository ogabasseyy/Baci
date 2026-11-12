import { render, screen } from '@testing-library/react-native';
import WalletGoalActionsRoute from '@/app/wallet/savings/goal-actions';

const mockParams = jest.fn();
const mockAuth = jest.fn();
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockAuth(),
}));
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`Redirect:${href}`}</Text>;
  },
  useLocalSearchParams: () => mockParams(),
}));

// The full-page cancel/complete screen is retired: these steps live in the
// savings sheet, so old links open that sheet without calling the server.
describe('old goal-actions links', () => {
  beforeEach(() => {
    mockAuth.mockReturnValue({ isLoading: false, redirectTo: null });
  });

  it('send a signed-out customer to sign in and back to the same goal', () => {
    mockAuth.mockReturnValue({ isLoading: false, redirectTo: '/auth/login' });
    mockParams.mockReturnValue({ goalId: 'g1', kind: 'complete' });
    render(<WalletGoalActionsRoute />);
    expect(
      screen.getByText(
        `Redirect:/auth/login?returnTo=${encodeURIComponent('/wallet?action=savings&savingsGoalId=g1')}`
      )
    ).toBeOnTheScreen();
  });

  it('wait while the session is restored', () => {
    mockAuth.mockReturnValue({ isLoading: true, redirectTo: null });
    mockParams.mockReturnValue({ goalId: 'g1' });
    render(<WalletGoalActionsRoute />);
    expect(screen.queryByText(/Redirect:/)).toBeNull();
  });

  it('open the savings sheet for the same goal', () => {
    mockParams.mockReturnValue({ goalId: 'goal 1', kind: 'cancel' });
    render(<WalletGoalActionsRoute />);
    expect(
      screen.getByText('Redirect:/wallet?action=savings&savingsGoalId=goal%201')
    ).toBeOnTheScreen();
  });

  it('fall back to the wallet without a goal', () => {
    mockParams.mockReturnValue({ kind: 'complete' });
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
  });
});
