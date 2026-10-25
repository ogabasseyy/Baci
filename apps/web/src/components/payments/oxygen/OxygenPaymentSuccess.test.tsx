import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';

afterEach(cleanup);
const reference = '70000000-0000-4000-8000-000000000001';
const plan: OxygenProviderState = {
  bookingReference: reference,
  booking: {
    loan_reference: reference,
    product_amount: 396000,
    equity_percentage: 25,
    equity_amount: 99000,
    loan_amount: 297000,
    loan_tenure: 6,
    status: 'BOOKED',
    total_charges: 5865.75,
    total_upfront_payment: 104865.75,
  },
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 27],
      amount: 61829,
      principal: 0,
      interest: 0,
    },
  ],
};
it('shows confirmed payment, the actual selected items, and the remaining order confirmation', () => {
  const done = vi.fn();
  render(
    <OxygenPaymentSuccess
      reference={reference}
      plan={plan}
      products={[
        {
          id: 'product-1',
          name: 'Samsung Galaxy A16 LTE',
          quantity: 2,
          price: 198000,
        },
      ]}
      onDone={done}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'Payment confirmed' })
  ).toBeVisible();
  expect(screen.getByText('Samsung Galaxy A16 LTE')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('₦104,865.75');
  expect(screen.getByText('Awaiting order confirmation')).toBeVisible();
  expect(
    screen.queryByText(/order confirmed|ready for delivery|order complete/i)
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to checkout' }));
  expect(done).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole('button', {
      name: /approve|activate|settle|pay again|continue to payment/i,
    })
  ).toBeNull();
});
it('does not invent amounts or show another booking’s plan', () => {
  render(<OxygenPaymentSuccess reference="different-reference" plan={plan} />);
  expect(screen.queryByText(/₦/)).toBeNull();
  expect(screen.queryByText('View selected plan')).toBeNull();
});
it('keeps the selected repayment breakdown available without overwhelming the success screen', () => {
  render(<OxygenPaymentSuccess reference={reference} plan={plan} />);
  expect(screen.getByText('Due upfront')).not.toBeVisible();
  fireEvent.click(screen.getByText('View selected plan'));
  expect(screen.getByRole('region', { name: 'Plan summary' })).toBeVisible();
});
