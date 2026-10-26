import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { TransferActions } from './TransferActions';

it('does not offer wallet transfer confirmation before an account number exists', () => {
  render(
    <TransferActions
      colors={Colors.light}
      controller={{
        fundingAccount: null,
        isSubmitting: false,
        handleCopyFundingAccount: jest.fn(async () => undefined),
        submitSavingsGoal: jest.fn(async () => undefined),
      }}
    />
  );

  expect(
    screen.queryByRole('button', { name: 'Retry savings creation' })
  ).toBeNull();
  expect(screen.queryByText("I've funded wallet")).toBeNull();
});
