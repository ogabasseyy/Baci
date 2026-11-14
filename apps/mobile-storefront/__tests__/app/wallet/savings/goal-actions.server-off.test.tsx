import { fireEvent, render, screen } from '@testing-library/react-native';
import WalletGoalActionsRoute from '@/app/wallet/savings/goal-actions';

const mockParams = jest.fn();
const mockAuth = jest.fn();
const mockWallet = jest.fn();
jest.mock('@/hooks/use-wallet', () => ({ useWallet: () => mockWallet() }));
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
const GOAL = '0b7d3c52-6f0e-4d1a-9c2b-3e4f5a6b7c8d';

describe('old goal-actions links', () => {
  beforeEach(() => {
    mockAuth.mockReturnValue({ isLoading: false, redirectTo: null });
    mockWallet.mockReturnValue({
      isLoading: false,
      data: { wallet: { savings_goals: [{ id: GOAL }] } },
    });
  });

  it('send a signed-out customer to sign in and back to the same goal', () => {
    mockAuth.mockReturnValue({ isLoading: false, redirectTo: '/auth/login' });
    mockParams.mockReturnValue({ goalId: GOAL, kind: 'complete' });
    render(<WalletGoalActionsRoute />);
    expect(
      screen.getByText(
        `Redirect:/auth/login?returnTo=${encodeURIComponent(`/wallet/savings/goal-actions?goalId=${GOAL}`)}`
      )
    ).toBeOnTheScreen();
  });

  it('wait while the session is restored', () => {
    mockAuth.mockReturnValue({ isLoading: true, redirectTo: null });
    mockParams.mockReturnValue({ goalId: GOAL });
    render(<WalletGoalActionsRoute />);
    expect(screen.queryByText(/Redirect:/)).toBeNull();
  });

  it('open the savings sheet for the same goal', () => {
    mockParams.mockReturnValue({ goalId: GOAL, kind: 'cancel' });
    render(<WalletGoalActionsRoute />);
    expect(
      screen.getByText(`Redirect:/wallet?action=savings&savingsGoalId=${GOAL}`)
    ).toBeOnTheScreen();
  });

  it("open the plain wallet when the goal is no longer the customer's", () => {
    mockWallet.mockReturnValue({
      isLoading: false,
      data: { wallet: { savings_goals: [{ id: 'another-goal' }] } },
    });
    mockParams.mockReturnValue({ goalId: GOAL, kind: 'cancel' });
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
  });

  it('wait for the wallet before deciding', () => {
    mockWallet.mockReturnValue({ isLoading: true, data: undefined });
    mockParams.mockReturnValue({ goalId: GOAL });
    render(<WalletGoalActionsRoute />);
    expect(screen.queryByText(/Redirect:/)).toBeNull();
  });

  it('keep the link and offer a retry when the wallet fails to load', () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockWallet.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    });
    mockParams.mockReturnValue({ goalId: GOAL });
    render(<WalletGoalActionsRoute />);
    expect(screen.queryByText(/Redirect:/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('wait while the wallet read is held after an account switch', () => {
    mockWallet.mockReturnValue({
      isLoading: false,
      isError: false,
      data: undefined,
    });
    mockParams.mockReturnValue({ goalId: GOAL });
    render(<WalletGoalActionsRoute />);
    expect(screen.queryByText(/Redirect:/)).toBeNull();
  });

  it('open the plain wallet for a malformed goal id', () => {
    mockParams.mockReturnValue({ goalId: 'goal 1', kind: 'cancel' });
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
  });

  it('fall back to the wallet without a goal', () => {
    mockParams.mockReturnValue({ kind: 'complete' });
    render(<WalletGoalActionsRoute />);
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
  });
});

describe('bugfix: goal link hung or trusted a stale goal list', () => {
  beforeEach(() => {
    mockAuth.mockReturnValue({ isLoading: false, redirectTo: null });
    mockParams.mockReturnValue({ goalId: GOAL });
  });

  it('offers a retry when the wallet read never starts', () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockWallet.mockReturnValue({
      isError: false,
      data: undefined,
      fetchStatus: 'idle',
      refetch,
    });
    render(<WalletGoalActionsRoute />);
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not trust a cached goal list when the refresh failed', () => {
    mockWallet.mockReturnValue({
      isError: true,
      data: { wallet: { savings_goals: [{ id: GOAL }] } },
      refetch: jest.fn(),
    });
    render(<WalletGoalActionsRoute />);
    expect(screen.queryByText(/Redirect:/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
