import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenLoanSummary } from './OxygenLoanSummary';

const booking = {
  loan_reference: '70000000-0000-4000-8000-000000000001',
  product_amount: 400000,
  loan_amount: 260000,
  equity_percentage: 35,
  equity_amount: 140000,
  loan_tenure: 3,
  status: 'BOOKED' as const,
};
it('keeps upfront charges separate from the installment schedule and formats naira and dates', () => {
  render(
    <OxygenLoanSummary
      state={{
        booking: {
          ...booking,
          total_charges: 5135,
          total_upfront_payment: 145135,
        },
        schedule: [
          {
            period: 1,
            dueDate: [2026, 10, 25],
            amount: 95000,
            principal: 90000,
            interest: 5000,
          },
        ],
      }}
    />
  );
  expect(screen.getByText('₦5,135.00')).toBeVisible();
  expect(screen.getByText('₦145,135.00')).toBeVisible();
  const schedule = screen.getByRole('list');
  expect(within(schedule).getByText('25 Oct 2026')).toBeVisible();
  expect(within(schedule).getByText('₦95,000.00')).toBeVisible();
  expect(within(schedule).queryByText('₦5,135.00')).toBeNull();
});
it('does not invent zero charges when Oxygen has not supplied them', () => {
  render(<OxygenLoanSummary state={{ booking }} />);
  expect(screen.getByText('Awaiting confirmation')).toBeVisible();
  expect(screen.queryByText('₦0.00')).toBeNull();
  expect(screen.queryByText('Total due upfront')).toBeNull();
});
it('shows the booked upfront total from equity plus confirmed breakdown charges before approval', () => {
  render(<OxygenLoanSummary state={{ booking, quotedCharges: 5083.65 }} />);
  expect(screen.getByText('₦5,083.65')).toBeVisible();
  expect(screen.getByText('Total due upfront')).toBeVisible();
  expect(screen.getByText('₦145,083.65')).toBeVisible();
});
