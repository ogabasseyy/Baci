import { render, screen } from '@testing-library/react-native';
import { PlanFundingReadyNote } from './PlanFundingReadyNote';
import type { StartSavingsColors } from './start-savings.types';

const colors = { textSecondary: '#555555' } as StartSavingsColors;

describe('PlanFundingReadyNote', () => {
  it('tells the customer to fund the plan from their wallet', () => {
    render(<PlanFundingReadyNote colors={colors} />);
    expect(
      screen.getByText(/fund it by moving money from your wallet/i)
    ).toBeTruthy();
    expect(screen.getByText(/do not take bank transfers/i)).toBeTruthy();
  });

  it('never shows bank account details', () => {
    render(<PlanFundingReadyNote colors={colors} />);
    expect(screen.queryByText(/account number/i)).toBeNull();
    expect(screen.queryByText(/\b\d{10}\b/)).toBeNull();
  });
});
