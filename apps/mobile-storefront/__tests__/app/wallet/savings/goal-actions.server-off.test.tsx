import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import WalletGoalActionsRoute from '@/app/wallet/savings/goal-actions';
import { useSavingsNoticeStore } from '@/components/wallet/savings/savings-notice-store';

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

  it("open the plain wallet when the goal is no longer the customer's, after one fresh read", async () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockWallet.mockReturnValue({
      isLoading: false,
      data: { wallet: { savings_goals: [{ id: 'another-goal' }] } },
      refetch,
    });
    mockParams.mockReturnValue({ goalId: GOAL, kind: 'cancel' });
    render(<WalletGoalActionsRoute />);
    expect(await screen.findByText('Redirect:/wallet')).toBeOnTheScreen();
    expect(refetch).toHaveBeenCalledTimes(1);
    // A short note explains why the old link opened the plain wallet.
    expect(useSavingsNoticeStore.getState().notice?.title).toBe(
      'That savings plan has closed'
    );
  });

  it('keep the link with a retry when the fresh read fails', async () => {
    const refetch = jest.fn().mockResolvedValue({ isError: true });
    mockWallet.mockReturnValue({
      isLoading: false,
      data: { wallet: { savings_goals: [{ id: 'another-goal' }] } },
      refetch,
    });
    mockParams.mockReturnValue({ goalId: GOAL });
    render(<WalletGoalActionsRoute />);
    expect(
      await screen.findByRole('button', { name: 'Try again' })
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Redirect:/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));
  });

  it('give each missing goal its own fresh read', async () => {
    const OTHER = '1c8e4d63-7a0b-4e2c-8d3f-4f5a6b7c8d9e';
    const refetch = jest.fn().mockResolvedValue({ isError: false });
    mockWallet.mockReturnValue({
      isLoading: false,
      data: { wallet: { savings_goals: [{ id: 'another-goal' }] } },
      refetch,
    });
    mockParams.mockReturnValue({ goalId: GOAL });
    const view = render(<WalletGoalActionsRoute />);
    await screen.findByText('Redirect:/wallet');
    mockParams.mockReturnValue({ goalId: OTHER });
    view.rerender(<WalletGoalActionsRoute />);
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));
  });

  it('open a goal the fresh read finds, though the cached wallet missed it', async () => {
    let goals = [{ id: 'another-goal' }];
    const refetch = jest.fn(async () => {
      goals = [{ id: GOAL }];
    });
    mockWallet.mockImplementation(() => ({
      isLoading: false,
      data: { wallet: { savings_goals: goals } },
      refetch,
    }));
    mockParams.mockReturnValue({ goalId: GOAL });
    render(<WalletGoalActionsRoute />);
    expect(
      await screen.findByText(
        `Redirect:/wallet?action=savings&savingsGoalId=${GOAL}`
      )
    ).toBeOnTheScreen();
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

  it('offer to keep waiting when the wallet read stays silent too long', () => {
    jest.useFakeTimers();
    try {
      mockWallet.mockReturnValue({
        isLoading: false,
        isError: false,
        data: undefined,
      });
      mockParams.mockReturnValue({ goalId: GOAL });
      render(<WalletGoalActionsRoute />);
      expect(screen.queryByRole('button', { name: 'Keep waiting' })).toBeNull();
      act(() => {
        jest.advanceTimersByTime(15_000);
      });
      expect(screen.getByText('Still opening your savings')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Keep waiting' }));
      expect(screen.queryByRole('button', { name: 'Keep waiting' })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
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
