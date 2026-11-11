import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { oxygenProviderStateSchema } from '@/schemas/oxygen-runtime';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenSavedPlans } from './OxygenSavedPlans';

beforeEach(() => mocks.fetch.mockReset());
const id = '60000000-0000-4000-8000-000000000001';
const ref25 = '70000000-0000-4000-8000-000000000025';
const ref50 = '70000000-0000-4000-8000-000000000050';
const ref6 = '70000000-0000-4000-8000-000000000006';
function plan(ref: string, equity: number, tenure = 3) {
  return {
    bookingReference: ref,
    productAmount: 400000,
    equityPercentage: equity,
    tenure,
    state: {
      bookingReference: ref,
      booking: {
        loan_reference: ref,
        status: 'BOOKED',
        product_amount: 400000,
        equity_percentage: equity,
        equity_amount: 4000 * equity,
        loan_amount: 400000 - 4000 * equity,
        loan_tenure: tenure,
      },
      quotedCharges: 5000,
      schedule: Array.from({ length: tenure }, (_, i) => ({
        period: i + 1,
        dueDate: [2027, i + 1, 27],
        amount: 110000,
        principal: 100000,
        interest: 10000,
      })),
    },
    updatedAt: '2026-10-23T12:00:00Z',
  };
}
it('requires explicit confirmation before cancelling a no-longer-offered plan with an active code', async () => {
  const cancel = vi.fn().mockResolvedValue(true);
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      approvalReference={ref25}
      approvalCodeStarted
      cancelUnavailablePlan={cancel}
      state={oxygenProviderStateSchema.parse({
        ...plan(ref25, 25).state,
        eligibleAmount: 400000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [{ tenure: 3, loanAmount: 200000 }],
      })}
    />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Choose another plan' })
  );
  expect(cancel).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('heading', { name: /sign and accept/i })
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Cancel plan and continue' })
  );
  expect(cancel).toHaveBeenCalledOnce();
});
it('lets an unapproved legacy booking refresh its missing offers without losing the saved plan', async () => {
  const refreshOffers = vi.fn().mockResolvedValue(true);
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={oxygenProviderStateSchema.parse(plan(ref25, 25).state)}
      refreshOffers={refreshOffers}
      requestApprovalCode={vi.fn()}
    />
  );
  const button = await screen.findByRole('button', {
    name: 'Update payment options',
  });
  expect(screen.getByText(ref25)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  fireEvent.click(button);
  expect(refreshOffers).toHaveBeenCalledOnce();
});
it('does not request an invalid new plan when a shorter period has a lower limit', async () => {
  mocks.fetch.mockImplementation(async () =>
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  const state = {
    ...plan(ref25, 25).state,
    eligibleAmount: 400000,
    minimumAmount: 10000,
    maxTenure: 3,
    offers: [
      { tenure: 1, loanAmount: 68000 },
      { tenure: 3, loanAmount: 400000 },
    ],
  };
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={oxygenProviderStateSchema.parse(state)}
    />
  );
  await screen.findByRole('radio', { name: '1 month' });
  fireEvent.click(screen.getByRole('radio', { name: '1 month' }));
  expect(screen.getByText(/adjust your down payment/i)).toBeVisible();
  expect(
    mocks.fetch.mock.calls.filter(
      ([url, options]) => url.includes('/quote') && options?.method === 'POST'
    )
  ).toHaveLength(0);
});

it('directs an already started approval to support if the refreshed offer no longer covers it', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      approvalCodeStarted
      state={oxygenProviderStateSchema.parse({
        ...plan(ref25, 25).state,
        eligibleAmount: 400000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [{ tenure: 3, loanAmount: 100000 }],
      })}
    />
  );
  expect(await screen.findByText(/please contact support/i)).toBeVisible();
  expect(screen.getByRole('radio', { name: '3 months' })).toBeDisabled();
});

it('offers a refresh instead of opening an existing approval code when offers are missing', async () => {
  const refreshOffers = vi.fn().mockResolvedValue(true);
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      approvalReference={ref25}
      approvalCodeStarted
      refreshOffers={refreshOffers}
      state={oxygenProviderStateSchema.parse(plan(ref25, 25).state)}
    />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Update payment options' })
  );
  expect(refreshOffers).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole('heading', { name: /sign and accept/i })
  ).not.toBeInTheDocument();
});

it('checks the selected saved plan against its offer rather than the previous booking', async () => {
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      selectedReference: ref25,
      plans: [plan(ref25, 25), plan(ref50, 50)],
    })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      onAccept={vi.fn()}
      state={oxygenProviderStateSchema.parse({
        ...plan(ref25, 25).state,
        eligibleAmount: 400000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [{ tenure: 3, loanAmount: 250000 }],
      })}
    />
  );
  const accept = await screen.findByRole('button', {
    name: 'Accept payment plan',
  });
  expect(accept).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '50%' }));
  expect(accept).toBeEnabled();
});

it('keeps an older saved repayment period visible after the maximum changes', async () => {
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      selectedReference: ref25,
      plans: [plan(ref25, 25), plan(ref6, 25, 6)],
    })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      onAccept={vi.fn()}
      state={oxygenProviderStateSchema.parse({
        ...plan(ref25, 25).state,
        eligibleAmount: 400000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [
          { tenure: 3, loanAmount: 400000 },
          { tenure: 6, loanAmount: 400000 },
        ],
      })}
    />
  );
  fireEvent.click(await screen.findByRole('radio', { name: '6 months' }));
  expect(
    screen.getByRole('button', { name: 'Accept payment plan' })
  ).toBeDisabled();
});
