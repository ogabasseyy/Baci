import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { BRAND } from '@/constants/Colors';
import { SavingsPlansScreen } from './SavingsPlansScreen';

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
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/use-wallet', () => ({ useWallet: () => mockQuery }));
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => ({ isLoading: false, redirectTo: null }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = {
    data: { wallet: { savings_goals: goals } },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: mockRefetch,
  };
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
