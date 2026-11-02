import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));

import { continueWithSignature } from './approval-test-helpers';
import { OxygenApprovalCode } from './OxygenApprovalCode';

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
beforeEach(() => vi.clearAllMocks());
const id = '60000000-0000-4000-8000-000000000001';
const ref = '70000000-0000-4000-8000-000000000025';
const state: OxygenProviderState = {
  bookingReference: ref,
  booking: {
    loan_reference: ref,
    status: 'BOOKED',
    product_amount: 400000,
    equity_percentage: 25,
    equity_amount: 100000,
    loan_amount: 300000,
    loan_tenure: 1,
  },
  quotedCharges: 5000,
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 27],
      amount: 310000,
      principal: 300000,
      interest: 10000,
    },
  ],
};
const timing = (sentAt: number, reference = ref) => ({
  window: {
    bookingReference: reference,
    sentAt: new Date(sentAt).toISOString(),
    expiresAt: new Date(sentAt + 300000).toISOString(),
  },
});
it('honours expired timing even after Continue, and sends again only after another explicit Continue', async () => {
  const request = vi.fn().mockResolvedValue(true);
  m.fetch.mockImplementation(async () =>
    Response.json(timing(Date.now() - 600000))
  );
  const view = render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  continueWithSignature();
  await screen.findByText('Code expired');
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
  view.unmount();
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  continueWithSignature();
  await screen.findByText('Code expired');
  expect(request).toHaveBeenCalledTimes(2);
});
it('resends only on an explicit click using this exact reference and reloads the confirmed timing', async () => {
  let sentAt = Date.now() - 600000;
  m.fetch.mockImplementation(async () => Response.json(timing(sentAt)));
  const request = vi.fn(async (_reference: string) => {
    sentAt = Date.now();
    return true;
  });
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  continueWithSignature();
  await waitFor(() =>
    expect(screen.getByRole('timer')).toHaveTextContent('5:00')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitFor(() =>
    expect(screen.getByRole('timer')).toHaveTextContent('5:00')
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(([reference]) => reference === ref)).toBe(
    true
  );
  expect(
    screen.queryByRole('button', { name: 'Verify and approve plan' })
  ).toBeNull();
  expect(
    m.fetch.mock.calls.every(([url]) => url.includes('/approval-code?'))
  ).toBe(true);
});
it('rejects a timing record belonging to another reference', async () => {
  const request = vi.fn().mockResolvedValue(true);
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now(), id)));
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  continueWithSignature();
  await screen.findByRole('button', { name: 'Check code status' });
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  expect(request).toHaveBeenCalledExactlyOnceWith(ref);
});
