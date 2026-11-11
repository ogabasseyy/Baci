import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenBookedPlanReview } from './OxygenBookedPlanReview';

vi.mock('./OxygenSavedPlans', () => ({
  OxygenSavedPlans: ({
    onAccept,
    refreshOffers,
  }: {
    onAccept: (ref: string) => void;
    refreshOffers?: () => Promise<boolean>;
  }) => (
    <>
      <button type="button" onClick={() => onAccept('cached-reference')}>
        Select cached plan
      </button>
      {refreshOffers && (
        <button type="button" onClick={() => void refreshOffers()}>
          Update payment options
        </button>
      )}
    </>
  ),
}));
const state: OxygenProviderState = {
  bookingReference: 'selected-reference',
  booking: {
    status: 'BOOKED',
    loan_reference: 'selected-reference',
    product_amount: 198000,
    equity_amount: 49500,
    loan_amount: 148500,
    equity_percentage: 25,
    loan_tenure: 3,
  },
  quotedCharges: 2932.88,
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 26],
      amount: 55442,
      principal: 46695.35,
      interest: 8746.65,
    },
  ],
};
it('shows confirmed figures before address verification and accepts only the selected reference', () => {
  const accept = vi.fn();
  render(
    <OxygenBookedPlanReview
      workflowId="workflow"
      state={state}
      busy={false}
      onAccept={accept}
    />
  );
  expect(screen.getByText('₦52,432.88')).toBeVisible();
  expect(screen.getAllByText('₦55,442.00')[0]).toBeVisible();
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Accept payment plan' }));
  expect(accept).toHaveBeenCalledExactlyOnceWith('selected-reference');
});
it('allows an older booked application to refresh offers while comparing plans', () => {
  const refreshOffers = vi.fn().mockResolvedValue(true);
  render(
    <OxygenBookedPlanReview
      workflowId="workflow"
      state={state}
      busy={false}
      onAccept={vi.fn()}
      refreshOffers={refreshOffers}
    />
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Change down payment or repayment period',
    })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Update payment options' })
  );
  expect(refreshOffers).toHaveBeenCalledOnce();
});
it('opens cached plan choices without approving or accepting', () => {
  const accept = vi.fn();
  render(
    <OxygenBookedPlanReview
      workflowId="workflow"
      state={state}
      busy={false}
      onAccept={accept}
    />
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Change down payment or repayment period',
    })
  );
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Select cached plan' }));
  expect(accept).toHaveBeenCalledExactlyOnceWith('cached-reference');
});
it('blocks acceptance while provider details are missing', () => {
  render(
    <OxygenBookedPlanReview
      workflowId="workflow"
      state={{ ...state, schedule: undefined }}
      busy={false}
      onAccept={vi.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Accept payment plan' })
  ).toBeDisabled();
  expect(screen.queryByText('₦52,432.88')).toBeNull();
});
