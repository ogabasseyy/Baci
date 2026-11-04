import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

it('retries only the failed breakdown lookup and shows confirmed charges and repayments before OTP', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const booking = {
    loan_reference: id,
    product_amount: 396000,
    loan_amount: 257400,
    equity_percentage: 35,
    equity_amount: 138600,
    loan_tenure: 3,
    status: 'BOOKED',
  };
  let attempts = 0;
  const snapshot = () => ({
    workflowId: id,
    stage: 'approval_required',
    version: 4 + attempts,
    environment: 'staging',
    executionEnabled: true,
    state: {
      bookingReference: id,
      booking,
      ...(attempts > 1
        ? {
            quotedCharges: 5083.65,
            schedule: [
              {
                period: 1,
                dueDate: [2026, 11, 27],
                amount: 96474,
                principal: 80772.6,
                interest: 15701.4,
              },
            ],
          }
        : {}),
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  });
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('/plans?'))
      return Response.json({ plans: [], selectedReference: null });
    if (url.endsWith('/actions') && options?.method === 'POST') {
      const payload = JSON.parse(String(options.body));
      expect(payload.command).toEqual({ action: 'refresh_details' });
      attempts++;
      return attempts === 1
        ? Response.json(
            { error: 'Unable to confirm this step' },
            { status: 409 }
          )
        : Response.json(snapshot());
    }
    return Response.json(url.includes('?') ? snapshot() : { workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} merchantSlug="shop" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry payment breakdown' })
  );
  await waitFor(() => expect(screen.getByText('₦5,083.65')).toBeVisible());
  expect(screen.getByText('₦143,683.65')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(attempts).toBe(2);
  expect(
    mocks.fetch.mock.calls
      .filter(([url, o]) => url.endsWith('/actions') && o?.method === 'POST')
      .map(([, o]) => JSON.parse(String(o?.body)).command.action)
  ).toEqual(['refresh_details', 'refresh_details']);
});
