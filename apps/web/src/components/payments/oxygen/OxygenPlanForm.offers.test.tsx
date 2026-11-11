import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenPlanForm } from './OxygenPlanForm';

it('selects the same fallback tenure regardless of Oxygen offer ordering', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100000}
      eligibleAmount={100000}
      minimumAmount={10000}
      maxTenure={6}
      submit={vi.fn()}
      offers={[
        { tenure: 1, loanAmount: 100000 },
        { tenure: 6, loanAmount: 100000 },
      ]}
    />
  );
  expect(screen.getByRole('radio', { name: '6 months' })).toBeChecked();
});

it('does not display a stale offer above the maximum repayment period', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100000}
      eligibleAmount={100000}
      minimumAmount={10000}
      maxTenure={3}
      submit={vi.fn()}
      offers={[
        { tenure: 3, loanAmount: 100000 },
        { tenure: 6, loanAmount: 100000 },
      ]}
    />
  );
  expect(screen.getByRole('radio', { name: '3 months' })).toBeVisible();
  expect(
    screen.queryByRole('radio', { name: '6 months' })
  ).not.toBeInTheDocument();
});

it('uses the overall eligibility cap in the selected offer guidance', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100000}
      eligibleAmount={50000}
      minimumAmount={10000}
      maxTenure={1}
      submit={vi.fn()}
      offers={[{ tenure: 1, loanAmount: 90000 }]}
    />
  );
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '30000' },
  });
  expect(
    screen.getByText(/increase your down payment to at least 50%/i)
  ).toBeVisible();
});

it('does not suggest an impossible down payment when the offer is below the minimum loan', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100000}
      eligibleAmount={100000}
      minimumAmount={40000}
      maxTenure={3}
      submit={vi.fn()}
      offers={[
        { tenure: 1, loanAmount: 10000 },
        { tenure: 3, loanAmount: 100000 },
      ]}
    />
  );
  fireEvent.click(screen.getByRole('radio', { name: '1 month' }));
  expect(
    screen.getByText('This repayment period is not available for this order.')
  ).toBeVisible();
  expect(
    screen.queryByText(/increase your down payment/i)
  ).not.toBeInTheDocument();
});

it('requires a larger down payment when the selected period has a lower offer', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={198000}
      eligibleAmount={189000}
      minimumAmount={68000}
      maxTenure={3}
      submit={submit}
      offers={[
        { tenure: 1, loanAmount: 68000 },
        { tenure: 2, loanAmount: 131000 },
        { tenure: 3, loanAmount: 189000 },
      ]}
    />
  );
  fireEvent.click(screen.getByRole('radio', { name: '2 months' }));
  expect(
    screen.getByRole('button', { name: 'See full breakdown' })
  ).toBeDisabled();
  expect(screen.getByText(/increase your down payment/i)).toBeVisible();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).not.toHaveBeenCalled();
});
