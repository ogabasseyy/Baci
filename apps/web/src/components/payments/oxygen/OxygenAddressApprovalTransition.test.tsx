import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./OxygenSavedPlans', () => ({
  OxygenSavedPlans: ({ approvalReference }: { approvalReference?: string }) => (
    <h3>
      {approvalReference
        ? `Signature for ${approvalReference}`
        : 'Choose plan again'}
    </h3>
  ),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

afterEach(() => vi.unstubAllGlobals());
it('automatically opens signing for the accepted reference when the address check returns DONE', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const id = '60000000-0000-4000-8000-000000000001';
  const ref = '70000000-0000-4000-8000-000000000025';
  let done = false;
  const snapshot = () => ({
    workflowId: id,
    stage: done ? 'approval_required' : 'booked',
    version: done ? 32 : 31,
    environment: 'staging',
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    state: {
      bookingReference: ref,
      booking: {
        status: 'BOOKED',
        loan_reference: ref,
        product_amount: 198000,
        equity_amount: 49500,
        equity_percentage: 25,
        loan_amount: 148500,
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
      kyc: {
        phone_status: 'DONE',
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        selfie_status: 'DONE',
        address_status: done ? 'DONE' : 'PROCESSING',
      },
    },
  });
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.includes('/draft'))
      return Response.json({ draft: null, version: 0 });
    if (url.endsWith('/actions') && done)
      return Response.json({
        ...snapshot(),
        stage: 'booked',
        state: {
          ...snapshot().state,
          kyc: { ...snapshot().state.kyc, address_status: 'PROCESSING' },
        },
        pending: {
          action: 'refresh_kyc',
          status: 'executing',
          idempotencyKey: id,
        },
      });
    if (url.endsWith('/actions')) return Response.json(snapshot());
    return Response.json(url.includes('?') ? snapshot() : { workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Accept payment plan' })
  );
  const check = await screen.findByRole('button', {
    name: 'Check for an update',
  });
  await waitFor(() => expect(check).toBeEnabled());
  done = true;
  fireEvent.click(check);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check for an update' })
    ).toBeEnabled()
  );
  expect(screen.queryByText('Choose plan again')).toBeNull();
  expect(
    screen.getByRole('heading', { name: 'Oxygen is reviewing your address' })
  ).toBeVisible();
  expect(
    await screen.findByRole(
      'heading',
      { name: `Signature for ${ref}` },
      { timeout: 20000 }
    )
  ).toBeVisible();
  expect(screen.queryByText('Choose plan again')).toBeNull();
  expect(
    mocks.fetch.mock.calls.filter(
      ([, options]) =>
        options?.method === 'POST' &&
        /trigger_approval_otp|approve_booking|cancel_booking|activate/.test(
          String(options.body)
        )
    )
  ).toHaveLength(0);
}, 25000);
