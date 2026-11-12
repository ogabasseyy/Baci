import { render, screen } from '@testing-library/react-native';
import WalletGoalActionsRoute from '@/app/wallet/savings/goal-actions';

const mockParams = jest.fn();
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
