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

it('labels a newly recorded reversal date as an observation', () => {
  render(
    <WalletTransactionHistory
      colors={Colors.dark}
      transactions={[
        {
          id: 'historical-reversal',
          goal_id: 'goal-2',
          amount: -3,
          type: 'adjustment',
          description: 'Paid savings interest reversal',
          source_type: 'savings_interest',
          created_at: '2026-10-27T08:00:00Z',
          date_basis: 'observed',
        },
      ]}
    />
  );
  expect(screen.getByText('-₦3')).toBeTruthy();
  expect(screen.getByText(/Observed/)).toBeTruthy();
  expect(
    screen.getByRole('text', {
      name: /Adjustment\. Paid savings interest reversal\. -₦3(?:\.00)?\. Observed/,
    })
  ).toBeOnTheScreen();
});

it('labels historical reversal timestamps as unavailable', () => {
  render(
    <WalletTransactionHistory
      colors={Colors.dark}
      transactions={[
        {
          id: 'historical-reversal',
          goal_id: 'goal-2',
          amount: -3,
          type: 'adjustment',
          description: 'Paid savings interest reversal',
          source_type: 'savings_interest',
          created_at: null,
          date_basis: 'unknown',
        },
      ]}
    />
  );
  expect(screen.getByText('Date unavailable')).toBeTruthy();
});

it('labels receipt and ledger times by their recorded source', () => {
  render(
    <WalletTransactionHistory
      colors={Colors.dark}
      transactions={[
        {
          id: 'received-interest',
          amount: 2,
          type: 'credit',
          description: 'Paid interest',
          source_type: 'savings_interest',
          created_at: '2026-10-27T08:00:00Z',
          date_basis: 'received',
        },
        {
          id: 'ledger-interest',
          amount: 1,
          type: 'credit',
          description: 'Legacy interest',
          source_type: 'savings_interest',
          created_at: '2026-10-26T08:00:00Z',
          date_basis: 'ledger',
        },
      ]}
    />
  );
  expect(screen.getByText(/Received/)).toBeTruthy();
  expect(screen.getByText(/Recorded/)).toBeTruthy();
});
