import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { BRAND } from '@/constants/Colors';
import { SavingsPlansScreen } from './SavingsPlansScreen';

const mockUseRequireAuth = jest.fn(() => ({
  isLoading: false,
  redirectTo: null as string | null,
}));
const mockRefetch = jest.fn();
let mockQuery: {
  data?: { wallet: { savings_goals: typeof goals } };
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: typeof mockRefetch;
};
const goals = [
  {
    id: 'goal-1',
    title: 'Phone',
    current_amount: 100,
    target_amount: 250000,
    status: 'active',
  },
  {
    id: 'goal-2',
    title: 'Laptop',
    current_amount: 107.33,
    target_amount: 300000,
    status: 'paused',
  },
];
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) =>
    jest.requireActual<typeof import('react')>('react').createElement('View', {
      testID: 'savings-plans-redirect',
      accessibilityLabel: href,
      href,
    }),
  router: { push: jest.fn() },
}));
jest.mock('@/hooks/use-wallet', () => ({ useWallet: () => mockQuery }));
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockUseRequireAuth(),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRequireAuth.mockReturnValue({ isLoading: false, redirectTo: null });
  mockQuery = {
    data: { wallet: { savings_goals: goals } },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: mockRefetch,
  };
});
it('redirects an initially signed-out deep link to login with its return path', () => {
  mockUseRequireAuth.mockReturnValue({
    isLoading: false,
    redirectTo: '/auth/login?returnTo=%2Fwallet%2Fsavings',
  });
  render(<SavingsPlansScreen />);
  expect(screen.getByTestId('savings-plans-redirect')).toHaveProp(
    'href',
    '/auth/login?returnTo=%2Fwallet%2Fsavings'
  );
  expect(screen.queryByLabelText('Checking sign in')).toBeNull();
  expect(screen.queryByText('Your savings plans')).toBeNull();
});
it('keeps the initialization spinner while auth is loading', () => {
  mockUseRequireAuth.mockReturnValue({ isLoading: true, redirectTo: null });
  render(<SavingsPlansScreen />);
  expect(screen.getByLabelText('Checking sign in')).toBeOnTheScreen();
  expect(screen.queryByText('Your savings plans')).toBeNull();
});
it('shows separate balances and opens the chosen plan rather than the featured one', () => {
  render(<SavingsPlansScreen />);
  expect(screen.getByText('₦107.33')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Open Laptop' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/wallet',
    params: { action: 'savings', savingsGoalId: 'goal-2' },
  });
});
it('shows the combined saved amount without changing it when filtering plans', () => {
  render(<SavingsPlansScreen />);
  expect(screen.getByText('₦207.33')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Active plans' }));
  expect(screen.getByRole('button', { name: 'Open Phone' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Laptop' })).toBeNull();
  expect(screen.getByText('₦207.33')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'All plans' }));
  expect(screen.getByRole('button', { name: 'Open Laptop' })).toBeTruthy();
});
it('filters paused plans and exposes the selected filter accessibly', () => {
  render(<SavingsPlansScreen />);

  const pausedFilter = screen.getByRole('button', { name: 'Paused plans' });
  expect(pausedFilter).toHaveAccessibilityState({ selected: false });

  fireEvent.press(pausedFilter);

  expect(pausedFilter).toHaveAccessibilityState({ selected: true });
  expect(screen.getByRole('button', { name: 'Open Laptop' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Phone' })).toBeNull();
  expect(screen.getByText('CHOOSE A PLAN · 1')).toBeTruthy();
});
it('keeps new plan creation available when a filter has no matches', () => {
  render(<SavingsPlansScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Completed plans' }));
  expect(screen.getByText('No completed plans yet')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Start a new plan' }));
  expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
});
it('offers new plan creation with an empty list', () => {
  mockQuery.data = { wallet: { savings_goals: [] } };
  render(<SavingsPlansScreen />);
  expect(screen.getByRole('button', { name: 'Start a new plan' })).toHaveStyle({
    backgroundColor: BRAND.primary,
    minHeight: 50,
  });
  fireEvent.press(screen.getByRole('button', { name: 'Start a new plan' }));
  expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
});
it('provides retry without hiding cached plans on a refresh error', () => {
  mockQuery.isError = true;
  render(<SavingsPlansScreen />);
  expect(screen.getByRole('button', { name: 'Open Phone' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Retry loading plans' }));
  expect(mockRefetch).toHaveBeenCalled();
});
