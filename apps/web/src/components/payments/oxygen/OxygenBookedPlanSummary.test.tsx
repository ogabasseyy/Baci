import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenBookedPlanSummary } from './OxygenBookedPlanSummary';

const state = {
  bookingReference: 'ref',
  booking: {
    loan_reference: 'ref',
    product_amount: 71702.5,
    equity_percentage: 25,
    equity_amount: 17925.63,
    loan_amount: 53776.87,
    loan_tenure: 3,
    status: 'BOOKED',
    total_charges: 1062.09,
  },
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 26],
      amount: 20078,
      principal: 0,
      interest: 0,
    },
    {
      period: 2,
      dueDate: [2026, 12, 26],
      amount: 20078,
      principal: 0,
      interest: 0,
    },
    {
      period: 3,
      dueDate: [2027, 1, 26],
      amount: 20076.49,
      principal: 0,
      interest: 0,
    },
  ],
} satisfies OxygenProviderState;

it('shows the provider amounts and every payment date without needing expansion', () => {
  render(<OxygenBookedPlanSummary state={state} />);
  expect(screen.getByText('₦18,987.72')).toBeVisible();
  expect(screen.getByText(/₦1,062.09 charges/)).toBeVisible();
  expect(screen.getByText('26 Nov 2026')).toBeVisible();
  expect(screen.getByText('26 Dec 2026')).toBeVisible();
  expect(screen.getByText('26 Jan 2027')).toBeVisible();
  expect(screen.getAllByText('₦20,076.49').length).toBeGreaterThan(0);
});

it('does not present unconfirmed or incomplete figures as a plan', () => {
  render(<OxygenBookedPlanSummary state={{ ...state, schedule: [] }} />);
  expect(screen.queryByText(/₦/)).toBeNull();
  expect(screen.getByRole('status')).toBeVisible();
});

it('uses the provider upfront total and quoted charges when supplied', () => {
  render(
    <OxygenBookedPlanSummary
      state={{
        ...state,
        quotedCharges: 999,
        booking: {
          ...state.booking,
          total_charges: null,
          total_upfront_payment: 19000,
        },
      }}
    />
  );
  expect(screen.getByText('₦19,000.00')).toBeVisible();
  expect(screen.getByText(/₦999.00 charges/)).toBeVisible();
});

it('uses singular labels for a single repayment', () => {
  render(
    <OxygenBookedPlanSummary
      state={{
        ...state,
        booking: { ...state.booking, loan_tenure: 1 },
        schedule: [state.schedule[0]],
      }}
    />
  );
  expect(screen.getByText('1 month')).toBeVisible();
  expect(screen.getByText('1 payment')).toBeVisible();
});
