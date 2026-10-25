import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';

const state: OxygenProviderState = {
  bookingReference: 'reference',
  booking: {
    loan_reference: 'reference',
    product_amount: 396000,
    equity_percentage: 37.25,
    equity_amount: 147510,
    loan_amount: 248490,
    loan_tenure: 3,
    status: 'BOOKED',
  },
  quotedCharges: 4907.68,
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 27],
      amount: 93135,
      principal: 248490,
      interest: 0,
    },
    {
      period: 2,
      dueDate: [2026, 12, 27],
      amount: 93133.71,
      principal: 0,
      interest: 93133.71,
    },
  ],
};
it('hides all money while loading, even if a previous plan was supplied', () => {
  render(<OxygenComparisonSummary state={state} loading />);
  expect(screen.getByRole('region', { name: 'Plan summary' })).toHaveAttribute(
    'aria-busy',
    'true'
  );
  expect(screen.queryByText(/₦/)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Updating');
  expect(screen.queryByText(/Preparing/)).toBeNull();
});
it('shows upfront chips and toggles payment dates', () => {
  render(<OxygenComparisonSummary state={state} loading={false} />);
  expect(screen.getByText('₦152,417.68')).toBeVisible();
  expect(screen.getAllByText('₦93,135.00')[0]).toBeVisible();
  expect(screen.getByText('Due upfront')).toBeVisible();
  expect(screen.getByText('Down payment')).toBeVisible();
  expect(screen.getByText('Charges')).toBeVisible();
  expect(screen.getByText('27 Nov 2026')).not.toBeVisible();
  fireEvent.click(screen.getByText('View payment dates'));
  expect(screen.getByText('27 Nov 2026')).toBeVisible();
});
it('shows no guessed fees before the provider confirms a plan', () => {
  render(<OxygenComparisonSummary loading={false} />);
  expect(screen.queryByText(/₦/)).toBeNull();
  expect(screen.getByText(/Choose a period/)).toBeVisible();
});

it('does not render a stray zero or a confirmed monthly amount for an empty schedule', () => {
  render(
    <OxygenComparisonSummary
      state={{ ...state, schedule: [] }}
      loading={false}
    />
  );
  expect(screen.queryByText('0')).toBeNull();
  expect(screen.queryByText(/₦/)).toBeNull();
});

it('groups consecutive monthly payments and preserves the different final payment', () => {
  const schedule = [11, 12, 13, 14, 15, 16].map((month, index) => ({
    period: index + 1,
    dueDate: [
      month > 12 ? 2027 : 2026,
      month > 12 ? month - 12 : month,
      27,
    ] as [number, number, number],
    amount: index === 5 ? 61830.89 : 61829,
    principal: 0,
    interest: 0,
  }));
  render(
    <OxygenComparisonSummary state={{ ...state, schedule }} loading={false} />
  );
  fireEvent.click(screen.getByText('View payment dates'));
  expect(
    screen.getByRole('list', { name: 'Payment dates' }).children
  ).toHaveLength(2);
  expect(screen.getByText('5 payments · 27th of each month')).toBeVisible();
  expect(screen.getByText('27 Nov 2026 – 27 Mar 2027')).toBeVisible();
  expect(screen.getByText('27 Apr 2027')).toBeVisible();
});
it('keeps changed due days and skipped months separate instead of inventing a recurring date', () => {
  const schedule = [
    [2026, 11, 27],
    [2026, 12, 28],
    [2027, 2, 28],
  ].map((dueDate, index) => ({
    period: index + 1,
    dueDate: dueDate as [number, number, number],
    amount: 61829,
    principal: 0,
    interest: 0,
  }));
  render(
    <OxygenComparisonSummary state={{ ...state, schedule }} loading={false} />
  );
  fireEvent.click(screen.getByText('View payment dates'));
  expect(
    screen.getByRole('list', { name: 'Payment dates' }).children
  ).toHaveLength(3);
  expect(screen.queryByText(/of each month/)).toBeNull();
  expect(screen.getByText('28 Feb 2027')).toBeVisible();
});

it('places the verification heading and payment figures inside one summary card', () => {
  render(
    <OxygenComparisonSummary
      state={state}
      loading={false}
      heading="Verify your payment plan"
    />
  );
  const card = screen.getByRole('region', { name: 'Plan summary' });
  expect(card).toContainElement(
    screen.getByRole('heading', { name: 'Verify your payment plan' })
  );
  expect(card).toHaveTextContent('Due upfront');
  expect(card).toContainElement(screen.getByText('Plan verification'));
  expect(screen.getByText('Plan verification')).toHaveClass('text-red-700');
  expect(screen.queryByText(/6-digit/)).toBeNull();
});
