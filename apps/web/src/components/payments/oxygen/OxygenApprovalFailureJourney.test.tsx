import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

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
it('shows one reconciliation screen after indeterminate approval without returning to the plan selector', async () => {
  const snapshot = {
    workflowId: id,
    stage: 'reconciliation_required',
    version: 10,
    environment: 'staging',
    executionEnabled: true,
    state: plan(ref25, 25).state,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    pending: {
      action: 'approve_booking',
      status: 'indeterminate',
      idempotencyKey: id,
    },
  };
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json(
      url.includes('/draft?')
        ? { draft: null, version: 0 }
        : url.includes('/plans')
          ? { selectedReference: ref25, plans: [plan(ref25, 25)] }
          : url.includes('?')
            ? snapshot
            : { workflow: { id } }
    )
  );
  render(<OxygenProviderFlow orderId={id} />);
  await screen.findByRole('heading', {
    name: 'We couldn’t confirm your approval',
  });
  expect(
    screen.queryByRole('heading', { name: 'Choose your payment plan' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Request approval code' })
  ).toBeNull();
  expect(screen.queryByRole('link', { name: 'Pay upfront amount' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check for an update' })
    ).toBeEnabled()
  );
  expect(mocks.fetch.mock.calls.some(([url]) => url.includes('/plans'))).toBe(
    false
  );
  expect(
    mocks.fetch.mock.calls.some(
      ([url, options]) => url.endsWith('/actions') && options?.method === 'POST'
    )
  ).toBe(false);
});
