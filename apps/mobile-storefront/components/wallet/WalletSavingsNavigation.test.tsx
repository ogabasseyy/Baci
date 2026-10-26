import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Colors from '@/constants/Colors';
import { WalletSavingsNavigation } from './WalletSavingsNavigation';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

it('opens all plans and allows a new plan even when plans already exist', () => {
  render(<WalletSavingsNavigation colors={Colors.dark} count={3} />);
  fireEvent.press(screen.getByRole('button', { name: 'View all plans (3)' }));
  expect(router.push).toHaveBeenCalledWith('/wallet/savings');
  fireEvent.press(screen.getByRole('button', { name: 'Start a new plan' }));
  expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
});

it('hides both management links when the user has no savings plans', () => {
  render(<WalletSavingsNavigation colors={Colors.dark} count={0} />);
  expect(screen.queryByRole('button', { name: 'Start a new plan' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'View all plans (0)' })
  ).toBeNull();
});
