import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { continueWithSignature } from './approval-test-helpers';
import { OxygenSavedPlans } from './OxygenSavedPlans';

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  mocks.fetch.mockReset();
});
const id = '60000000-0000-4000-8000-000000000001';
const ref25 = '70000000-0000-4000-8000-000000000025';
const ref35 = '70000000-0000-4000-8000-000000000035';
function plan(ref: string, equity: number) {
  return {
    bookingReference: ref,
    productAmount: 400000,
    equityPercentage: equity,
    tenure: 3,
    state: {
      bookingReference: ref,
      booking: {
        loan_reference: ref,
        status: 'BOOKED',
        product_amount: 400000,
        equity_percentage: equity,
        equity_amount: 4000 * equity,
        loan_amount: 400000 - 4000 * equity,
        loan_tenure: 3,
      },
      quotedCharges: 5000,
      schedule: [1, 2, 3].map((period) => ({
        period,
        dueDate: [2026, 10 + period, 27],
        amount: 110000,
        principal: 100000,
        interest: 10000,
      })),
    },
    updatedAt: '2026-10-23T12:00:00Z',
  };
}
it('reviews the saved plan locally without requesting an approval OTP or submitting approval', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  expect(
    await screen.findByRole('button', { name: 'Continue' })
  ).toBeDisabled();
  expect(
    screen.queryByRole('heading', { name: 'Confirm your payment plan' })
  ).toBeNull();
  expect(screen.getByText(/Sign and accept your plan next/)).toBeVisible();
  expect(mocks.fetch.mock.calls.every(([url]) => url.includes('/plans'))).toBe(
    true
  );
});

it('keeps approval on the plan screen disabled and follows the exact selected cached reference', async () => {
  mocks.fetch.mockImplementation(async (_url: string, options?: RequestInit) =>
    Response.json({
      selectedReference:
        options?.method === 'POST'
          ? JSON.parse(String(options.body)).bookingReference
          : ref25,
      plans: [plan(ref25, 25), plan(ref35, 35)],
    })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: '35%' }));
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(screen.getByText('₦145,000.00')).toBeVisible();
  expect(screen.getByText(ref35)).toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Confirm selected plan' })
  ).toBeNull();
  expect(screen.getByRole('slider')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '25%' }));
  expect(screen.getByText(ref25)).toBeInTheDocument();
  expect(screen.getByText('₦105,000.00')).toBeVisible();
  expect(
    mocks.fetch.mock.calls.every(
      ([url]) => !url.includes('/actions') && !url.includes('/quote')
    )
  ).toBe(true);
});

it('resumes signature-first without sending a code on render', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  const request = vi.fn();
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
      approvalReference={ref25}
      requestApprovalCode={request}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'Sign and accept your payment plan' })
  ).toBeVisible();
  expect(
    screen.queryByRole('textbox', { name: 'Verification code' })
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it('requests a code only for the matching canonical selected reference', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({
      selectedReference: ref25,
      plans: [plan(ref25, 25), plan(ref35, 35)],
    })
  );
  const request = vi.fn().mockResolvedValue(true);
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
      requestApprovalCode={request}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  expect(request).not.toHaveBeenCalled();
  expect(
    screen.getByRole('heading', { name: 'Sign and accept your payment plan' })
  ).toBeVisible();
  continueWithSignature();
  await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith(ref25));
});
