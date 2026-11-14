import { act, fireEvent, render, screen } from '@testing-library/react-native';
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
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams(),
}));

const GOAL = '0b7d3c52-6f0e-4d1a-9c2b-3e4f5a6b7c8d';

// A goal link whose wallet read stays silent: no server call is made here.
describe('goal-actions links waiting on a silent wallet read', () => {
  beforeEach(() => {
    mockAuth.mockReturnValue({ isLoading: false, redirectTo: null });
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

  it('turn a read that hangs past a second wait into a failure that re-reads', () => {
    jest.useFakeTimers();
    try {
      const refetch = jest.fn().mockReturnValue(new Promise(() => {}));
      mockWallet.mockReturnValue({
        isLoading: false,
        isError: false,
        data: undefined,
        refetch,
      });
      mockParams.mockReturnValue({ goalId: GOAL });
      render(<WalletGoalActionsRoute />);
      act(() => {
        jest.advanceTimersByTime(15_000);
      });
      fireEvent.press(screen.getByRole('button', { name: 'Keep waiting' }));
      act(() => {
        jest.advanceTimersByTime(15_000);
      });
      expect(screen.getByText("Couldn't open your savings")).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(refetch).toHaveBeenCalledTimes(1);
      // A fresh wait starts: the spinner, then Keep waiting again.
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      act(() => {
        jest.advanceTimersByTime(15_000);
      });
      expect(
        screen.getByRole('button', { name: 'Keep waiting' })
      ).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });
});
