import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  provider: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('./use-oxygen-provider', () => ({ useOxygenProvider: mocks.provider }));
vi.mock('./OxygenBookedPlanReview', () => ({
  OxygenBookedPlanReview: ({
    onAccept,
  }: {
    onAccept: (ref: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onAccept('70000000-0000-4000-8000-000000000001')}
    >
      Accept cached plan A
    </button>
  ),
}));
vi.mock('./OxygenProviderStages', () => ({
  OxygenProviderStages: () => <p>Continue to verification</p>,
}));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

const workflow = '60000000-0000-4000-8000-000000000001';
const planA = '70000000-0000-4000-8000-000000000001';
const planB = '70000000-0000-4000-8000-000000000002';
const booking = {
  product_amount: 400000,
  equity_percentage: 35,
  equity_amount: 140000,
  loan_amount: 260000,
  loan_tenure: 3,
  status: 'BOOKED' as const,
};
const snapshot = {
  workflowId: workflow,
  stage: 'approval_required' as const,
  version: 8,
  environment: 'staging' as const,
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    bookingReference: planB,
    booking: { ...booking, loan_reference: planB },
  },
};
it('accepts cached A after B was quoted and continues only after canonical refresh', async () => {
  mocks.fetch.mockImplementation(async (url: string) =>
    url.includes('/actions?')
      ? Response.json(snapshot)
      : Response.json({ bookingReference: planA, version: 9 })
  );
  mocks.provider.mockImplementation(() => {
    const [current, setCurrent] = useState(snapshot);
    return {
      snapshot: current,
      busy: false,
      error: '',
      errorAction: null,
      clearError: vi.fn(),
      submit: vi.fn(),
      refresh: vi.fn(),
      needsSignIn: false,
      readSaved: async () => {
        mocks.read();
        setCurrent({
          ...snapshot,
          version: 9,
          state: {
            bookingReference: planA,
            booking: { ...booking, loan_reference: planA },
          },
        });
      },
    };
  });
  render(<OxygenProviderFlow orderId={workflow} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept cached plan A' }));
  await waitFor(() =>
    expect(screen.getByText('Continue to verification')).toBeVisible()
  );
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledWith(
    '/api/payments/oxygen/plans/accept',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        workflowId: workflow,
        bookingReference: planA,
        version: 8,
      }),
    })
  );
});

it('keeps review open and shows an error if acceptance is rejected', async () => {
  mocks.fetch.mockReset();
  mocks.read.mockReset();
  mocks.fetch.mockImplementation(async (url: string) =>
    url.includes('/actions?')
      ? Response.json(snapshot)
      : Response.json({ error: 'Plan unavailable' }, { status: 409 })
  );
  mocks.provider.mockImplementation(() => ({
    snapshot,
    busy: false,
    error: '',
    errorAction: null,
    clearError: vi.fn(),
    submit: vi.fn(),
    refresh: vi.fn(),
    needsSignIn: false,
    readSaved: mocks.read,
  }));
  render(<OxygenProviderFlow orderId={workflow} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept cached plan A' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be confirmed'
  );
  expect(
    screen.getByRole('button', { name: 'Accept cached plan A' })
  ).toBeVisible();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.queryByText('Continue to verification')).toBeNull();
});
