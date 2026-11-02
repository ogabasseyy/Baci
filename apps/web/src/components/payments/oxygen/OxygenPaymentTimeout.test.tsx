import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenPaymentRecovery } from './OxygenPaymentRecovery';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const reference = '70000000-0000-4000-8000-000000000001';
const recovery = {
  reference,
  paymentComplete: null,
  setupComplete: true,
  paymentUrl: null,
  setupUrl: null,
  checkedAt: null,
  lastOutcome: 'indeterminate',
  pending: false,
  resendBlocked: false,
};
const plan: OxygenProviderState = {
  bookingReference: reference,
  booking: {
    status: 'APPROVED',
    loan_reference: reference,
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
it('restores the approved plan after a timeout and checks only its exact reference before offering payment', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(recovery))
    .mockResolvedValueOnce(
      Response.json({
        ...recovery,
        paymentComplete: false,
        lastOutcome: 'succeeded',
        checkedAt: '2026-11-01T13:00:00Z',
      })
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenPaymentRecovery
      workflowId="60000000-0000-4000-8000-000000000001"
      reference={reference}
      version={3}
      planState={plan}
    />
  );
  const check = await screen.findByRole('button', {
    name: 'Check payment status',
  });
  expect(screen.getByText('Plan approved · Signature completed')).toBeVisible();
  expect(screen.getByText('₦52,432.88')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  fireEvent.click(check);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeEnabled()
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    action: 'check_status',
    reference,
  });
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: /approve|signature|OTP|cancel|activate|settle/i,
    })
  ).toBeNull();
});
