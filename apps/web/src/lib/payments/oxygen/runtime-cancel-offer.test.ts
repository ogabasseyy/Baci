import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OxygenProviderContext } from '@/schemas/oxygen-runtime';
import { executeOxygenAction } from './runtime-executor';

const id = '60000000-0000-4000-8000-000000000001';
const loan = '70000000-0000-4000-8000-000000000001';
const context: OxygenProviderContext = {
  workflowId: id,
  orderId: id,
  stage: 'approval_required',
  version: 1,
  environment: 'staging',
  partnerReference: 'partner',
  merchantReference: null,
  productAmount: 100000,
  orderPhone: '08012345678',
  productName: 'Phone',
  address: 'Street',
  state: {
    applicationReference: id,
    bookingReference: loan,
    validated: true,
    eligible: true,
    eligibleAmount: 80000,
    minimumAmount: 10000,
    maxTenure: 3,
    offers: [{ tenure: 3, loanAmount: 60000 }],
    activityToken: 'test-token',
    booking: {
      loan_reference: loan,
      product_amount: 100000,
      loan_amount: 75000,
      equity_percentage: 25,
      equity_amount: 25000,
      loan_tenure: 3,
      status: 'BOOKED',
    },
    kyc: {
      bvn_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      phone_status: 'DONE',
      selfie_status: 'DONE',
      address_status: 'DONE',
    },
  },
};

it('checks payment before cancelling and clears the active approval only on confirmed cancellation', async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      split_payment: { completed: false },
      repayment_setup: { completed: false },
    })
    .mockResolvedValueOnce({ message: 'Loan cancelled successfully' });
  const result = await executeOxygenAction(
    context,
    { action: 'cancel_booking' },
    { call },
    new Set()
  );
  expect(call.mock.calls.map(([operation]) => operation)).toEqual([
    'payment',
    'cancel',
  ]);
  expect(result.stage).toBe('plan_required');
  expect(result.state.bookingReference).toBeUndefined();
  expect(result.state.activityToken).toBeUndefined();
  expect(result.state.offers).toEqual(context.state.offers);
});

it('does not cancel a booking that Oxygen reports as paid', async () => {
  const call = vi.fn().mockResolvedValue({
    split_payment: { completed: true },
    repayment_setup: { completed: false },
  });
  await expect(
    executeOxygenAction(
      context,
      { action: 'cancel_booking' },
      { call },
      new Set()
    )
  ).rejects.toThrow('Paid booking requires reconciliation');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('payment', { loan_reference: loan });
});
