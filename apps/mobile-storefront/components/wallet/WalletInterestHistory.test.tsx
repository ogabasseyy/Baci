import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletTransactionHistory } from './WalletTransactionHistory';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

it('shows paid interest as a single-line transaction without adding a view-plan button', () => {
  render(
    <WalletTransactionHistory
      colors={Colors.dark}
      transactions={[
        {
          id: 'interest-1',
          goal_id: 'goal-2',
          amount: 7.33,
          type: 'credit',
          description: 'Savings interest credited · Laptop',
          source_type: 'savings_interest',
          created_at: '2026-10-13T08:00:00Z',
        },
      ]}
    />
  );
  expect(screen.getByText('+₦7.33')).toBeTruthy();
  expect(screen.getByText('Savings interest credited · Laptop')).toHaveProp(
    'numberOfLines',
    1
  );
  expect(screen.getByText('Savings interest credited · Laptop')).toHaveProp(
    'ellipsizeMode',
    'tail'
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(
    screen.getByRole('text', {
      name: /Credit\. Savings interest credited · Laptop\. \+₦7.33/,
    })
  ).toBeOnTheScreen();
});
